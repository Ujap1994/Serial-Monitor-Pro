// Real device sessions, recorded with the session capture from the long-run
// test boards (tests/soak/record-fixtures.soak.ts), replayed in every build:
//  - the application's decoders must understand what real firmware sent,
//  - the capture replayed as a device must give exactly the recorded answers.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { concatBytes, decodeLatin1, encodeUtf8 } from '@shared/core/bytes';
import { calculateCrc } from '@shared/core/crc';
import { parseCapture, type Capture } from '@shared/core/capture';
import { isModbusRtuValid } from '@shared/core/modbus';
import { isNmeaValid } from '@shared/core/nmea';
import { replayScript } from '@shared/core/replay';
import { burstByte, burstCrc } from '@shared/core/testdevice';
import type { SerialEvent } from '@shared/ipc';
import { SerialManager } from '../../src/main/serial';
import { addReplay, removeReplay } from '../../src/main/simulator';

const dir = join(import.meta.dirname, '..', 'fixtures', 'captures');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.smpcap')) : [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const load = (file: string): Capture => parseCapture(readFileSync(join(dir, file), 'utf8'));

/** What the device sent between the request starting with `prefix` and the next request. */
function answerTo(capture: Capture, prefix: string): Uint8Array {
  const step = replayScript(capture.events).steps.find((s) =>
    decodeLatin1(s.request).startsWith(prefix),
  );
  expect(step, `request ${prefix} in the capture`).toBeDefined();
  return concatBytes(...step!.replies.map((r) => r.data));
}

const lines = (bytes: Uint8Array) => decodeLatin1(bytes).split('\n');

describe.runIf(files.length > 0)('replay of real device captures', () => {
  it('has fixtures of the long-run boards and keeps them anonymous', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/"path"/);
      expect(text, file).not.toMatch(/\/dev\/|COM\d|\/Users\//);
    }
  });

  for (const file of files.filter((f) => !f.startsWith('rs232'))) {
    describe(file, () => {
      const capture = load(file);

      it('answers every request of the test protocol correctly', () => {
        const id = lines(answerTo(capture, 'ID?')).find((l) => l.startsWith('ID '));
        expect(id).toMatch(/^ID SMP-TD\/1 board=[\w-]+ fw=\d+\.\d+ uptime=\d+/);
        expect(lines(answerTo(capture, 'PING 42'))).toContain('PONG 42');
        // Text with UTF-8 comes back byte for byte.
        expect(decodeLatin1(answerTo(capture, 'ECHO'))).toContain(
          decodeLatin1(encodeUtf8('ECHO Hello capture – äöü\n')),
        );
        expect(lines(answerTo(capture, 'NOPE'))).toContain('ERR UNKNOWN NOPE');
      });

      it('checks CRC frames like the application calculates them', () => {
        const frames = replayScript(capture.events).steps.filter(
          (s) => s.request[0] === 0xaa && s.request[1] === 0x55,
        );
        expect(frames).toHaveLength(2);
        const [good, bad] = frames.map((s) =>
          decodeLatin1(concatBytes(...s.replies.map((r) => r.data))),
        );
        const body = frames[0]!.request.subarray(2, -2);
        const crc = calculateCrc(body, 'CRC-16/MODBUS').toString(16).toUpperCase().padStart(4, '0');
        expect(good).toContain(`ACK ${crc}`);
        expect(bad).toMatch(/NAK [0-9A-F]{4} [0-9A-F]{4}/);
      });

      it('streams sensor lines without gaps', () => {
        const sensor = lines(answerTo(capture, 'STREAM 100')).filter((l) => l.startsWith('Temp:'));
        expect(sensor.length).toBeGreaterThanOrEqual(8);
        const seq = sensor.map((l) => Number(/Seq:(\d+)/.exec(l)?.[1]));
        seq.slice(1).forEach((n, i) => expect(n).toBe(seq[i]! + 1));
        for (const l of sensor)
          expect(l).toMatch(/^Temp:-?[\d.]+, Humidity:-?[\d.]+, Pressure:-?[\d.]+, Seq:\d+\r?$/);
      });

      it('lets the NMEA decoder find exactly the intentionally damaged sentences', () => {
        const nmea = lines(answerTo(capture, 'NMEA 100')).filter((l) => l.startsWith('$GPGGA'));
        expect(nmea.length).toBeGreaterThanOrEqual(8);
        for (const sentence of nmea) {
          const seq = Number(sentence.slice(7, 13));
          // FAULT 3: every third sentence carries a wrong checksum.
          expect(isNmeaValid(sentence.trim()), sentence).toBe(seq % 3 !== 0);
        }
      });

      it('lets the Modbus RTU decoder accept every frame', () => {
        const raw = answerTo(capture, 'MODBUS 100');
        const ok = encodeUtf8('OK MODBUS 100\n');
        const start = decodeLatin1(raw).indexOf('OK MODBUS 100\n') + ok.length;
        const frames = raw.subarray(start);
        const count = Math.floor(frames.length / 9);
        expect(count).toBeGreaterThanOrEqual(5);
        for (let i = 0; i < count; i++)
          expect(isModbusRtuValid(frames.subarray(i * 9, i * 9 + 9)), `frame ${i}`).toBe(true);
      });

      it('delivers a burst completely and with the right CRC', () => {
        const raw = answerTo(capture, 'BURST 512');
        const head = encodeUtf8('BURST 512\n');
        const at = decodeLatin1(raw).indexOf('BURST 512\n');
        const data = raw.subarray(at + head.length, at + head.length + 512);
        data.forEach((b, i) => expect(b).toBe(burstByte(i)));
        expect(decodeLatin1(raw.subarray(at + head.length + 512))).toContain(
          `BURSTEND ${burstCrc(512).toString(16).toUpperCase().padStart(4, '0')}`,
        );
      });
    });
  }

  const managers: SerialManager[] = [];
  afterAll(async () => {
    for (const m of managers) await m.closeAll();
  });

  for (const file of files) {
    it(`${file}: replayed as a device, it gives exactly the recorded answers`, async () => {
      const capture = load(file);
      const info = addReplay(file, capture, { mode: 'answer', speed: 4, loop: true });
      const received: Uint8Array[] = [];
      const manager = new SerialManager((e: SerialEvent) => {
        if (e.kind === 'data') for (const c of e.chunks) received.push(c.data);
      });
      managers.push(manager);
      const opened = await manager.open('main', {
        path: info.path,
        baudRate: capture.header.port?.baudRate ?? 115200,
        dataBits: 8,
        parity: 'None',
        stopBits: '1',
      });
      expect(opened.ok).toBe(true);
      const script = replayScript(capture.events);
      await sleep(Math.max(0, ...script.greeting.map((g) => g.delay)) / 4 + 50);
      for (const step of script.steps) {
        received.length = 0;
        const expected = concatBytes(...step.replies.map((r) => r.data));
        await manager.write('main', step.request);
        const deadline = Date.now() + 3000;
        while (concatBytes(...received).length < expected.length && Date.now() < deadline)
          await sleep(5);
        expect(concatBytes(...received), decodeLatin1(step.request).slice(0, 20)).toEqual(expected);
      }
      await manager.close('main');
      removeReplay(info.path);
    }, 60_000);
  }
});
