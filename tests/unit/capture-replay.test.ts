// Session capture end to end: record a connection through the SerialManager,
// read the file back and replay it as a simulated device.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { concatBytes, decodeLatin1, encodeUtf8 } from '@shared/core/bytes';
import { captureSummary, parseCapture } from '@shared/core/capture';
import type { OpenOptions, SerialEvent } from '@shared/ipc';
import { CaptureWriter } from '../../src/main/capture';
import { SerialManager } from '../../src/main/serial';
import { addReplay, removeReplay, replayPorts } from '../../src/main/simulator';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const options = (path: string): OpenOptions => ({
  path,
  baudRate: 115200,
  dataBits: 8,
  parity: 'None',
  stopBits: '1',
});

function harness() {
  const received: Uint8Array[] = [];
  const manager = new SerialManager((e: SerialEvent) => {
    if (e.kind === 'data') for (const c of e.chunks) received.push(c.data);
  });
  const text = () => decodeLatin1(concatBytes(...received));
  /** Sends and waits until what came back since is complete. */
  const ask = async (data: string, done: (text: string) => boolean): Promise<string> => {
    received.length = 0;
    await manager.write('main', encodeUtf8(data));
    const deadline = Date.now() + 2000;
    while (!done(text()) && Date.now() < deadline) await sleep(5);
    await sleep(30); // nothing more may follow
    return text();
  };
  return { manager, received, text, ask };
}

const managers: SerialManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.closeAll();
});

describe('session capture and replay', () => {
  it('records a session byte for byte and replays it as a device that answers the same', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smp-capture-'));
    const file = join(dir, 'session.smpcap');

    // 1. Record a session with the simulated test device.
    const live = harness();
    managers.push(live.manager);
    expect((await live.manager.open('main', options('sim:testdevice'))).ok).toBe(true);
    const writer = new CaptureWriter(file, '9.9.9', live.manager.optionsOf('main'));
    live.manager.setTap('main', (e) => writer.record(e));
    await sleep(400); // boot message READY …
    const requests = ['ID?\n', 'PING 7\n', 'ECHO hello capture\n', 'BURST 300\n'];
    const answers: string[] = [];
    for (const r of requests) {
      const marker = r.startsWith('BURST')
        ? 'BURSTEND'
        : r.startsWith('ID')
          ? 'ID SMP'
          : r.startsWith('PING')
            ? 'PONG'
            : 'ECHO';
      answers.push(await live.ask(r, (t) => t.includes(marker) && t.endsWith('\n')));
    }
    await live.manager.close('main');
    live.manager.setTap('main', null);
    const stats = await writer.finish();
    expect(stats.error).toBeNull();
    expect(stats.txBytes).toBe(requests.join('').length);

    const capture = parseCapture(readFileSync(file, 'utf8'));
    expect(capture.header).toMatchObject({ app: '9.9.9', port: { path: 'sim:testdevice' } });
    const kinds = capture.events.map((e) => e.d);
    expect(kinds[0]).toBe('open');
    expect(kinds[kinds.length - 1]).toBe('close');
    const summary = captureSummary(capture.events);
    expect(summary.txBytes).toBe(stats.txBytes);
    expect(summary.rxBytes).toBe(stats.rxBytes);
    const sent = decodeLatin1(
      concatBytes(...capture.events.flatMap((e) => (e.d === 'tx' ? [e.data] : []))),
    );
    expect(sent).toBe(requests.join(''));

    // 2. Replay it: the same requests get exactly the recorded answers.
    const info = addReplay('session.smpcap', capture, { mode: 'answer', speed: 1, loop: true });
    expect(replayPorts().map((p) => p.path)).toContain(info.path);
    const replay = harness();
    managers.push(replay.manager);
    expect((await replay.manager.open('main', options(info.path))).ok).toBe(true);
    await sleep(400);
    expect(replay.text()).toContain('READY SMP-TD/1');
    for (const [i, r] of requests.entries()) {
      expect(await replay.ask(r, (t) => t.length >= answers[i]!.length)).toBe(answers[i]);
    }
    // Asked again in a different order: still the recorded answers.
    expect(await replay.ask('PING 7\n', (t) => t.length >= answers[1]!.length)).toBe(answers[1]);
    expect(await replay.ask('ID?\n', (t) => t.length >= answers[0]!.length)).toBe(answers[0]);
    removeReplay(info.path);
  }, 20_000);

  it('plays a stream back on its timeline in "timed" mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smp-capture-'));
    const file = join(dir, 'stream.smpcap');
    const live = harness();
    managers.push(live.manager);
    expect((await live.manager.open('main', options('sim:gps'))).ok).toBe(true);
    const writer = new CaptureWriter(file, '9.9.9', live.manager.optionsOf('main'));
    live.manager.setTap('main', (e) => writer.record(e));
    await sleep(1300);
    await live.manager.close('main');
    await writer.finish();
    const capture = parseCapture(readFileSync(file, 'utf8'));
    const recorded = decodeLatin1(
      concatBytes(...capture.events.flatMap((e) => (e.d === 'rx' ? [e.data] : []))),
    );
    expect(recorded).toContain('$GPGGA');

    const info = addReplay('stream.smpcap', capture, { mode: 'timed', speed: 4, loop: false });
    const replay = harness();
    managers.push(replay.manager);
    expect((await replay.manager.open('main', options(info.path))).ok).toBe(true);
    await replay.manager.write('main', encodeUtf8('ignored\n'));
    const deadline = Date.now() + 2000;
    while (replay.text().length < recorded.length && Date.now() < deadline) await sleep(10);
    expect(replay.text()).toBe(recorded);
    removeReplay(info.path);
  }, 20_000);
});
