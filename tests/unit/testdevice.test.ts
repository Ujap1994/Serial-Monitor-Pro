// The SMP-TD/1 test device: what every test firmware has to answer.
import { describe, expect, it } from 'vitest';
import {
  burstCrc,
  modbusFrame,
  nmeaLine,
  sensorLine,
  TD_MAX_FRAME,
  TestDeviceCore,
  testFrame,
} from '@shared/core/testdevice';
import { isModbusRtuValid } from '@shared/core/modbus';
import { isNmeaValid } from '@shared/core/nmea';
import { ascii, hex } from './helpers';

function device(start = 0) {
  let now = start;
  const out: number[] = [];
  let restarts = 0;
  const core = new TestDeviceCore(
    {
      write: (d) => out.push(...d),
      restart: () => {
        restarts++;
      },
    },
    () => now,
    'test',
  );
  const text = () => new TextDecoder('latin1').decode(Uint8Array.from(out));
  const lines = () => text().split('\n').filter(Boolean);
  return {
    core,
    out,
    lines,
    clear: () => out.splice(0),
    send: (s: string | Uint8Array) => core.input(typeof s === 'string' ? ascii(s) : s),
    advance: (ms: number) => {
      for (let i = 0; i < ms; i += 5) {
        now += 5;
        core.tick();
      }
    },
    restarts: () => restarts,
  };
}

describe('SMP-TD/1 test device', () => {
  it('boots with READY and answers PING, ECHO and ID?', () => {
    const d = device();
    d.core.boot();
    d.send('PING 42\r\nECHO hello world\nid?\n');
    expect(d.lines()).toEqual([
      'READY SMP-TD/1 board=test fw=1.0',
      'PONG 42',
      'ECHO hello world',
      'ID SMP-TD/1 board=test fw=1.0 uptime=0',
    ]);
  });

  it('echoes bytes unchanged and handles commands split across packets', () => {
    const d = device();
    d.send('EC');
    d.send(Uint8Array.from([0x48, 0x4f, 0x20, 0xe4, 0xff, 0x0a]));
    expect(d.out).toEqual([...ascii('ECHO '), 0xe4, 0xff, 0x0a]);
  });

  it('acknowledges correct frames and rejects wrong CRCs, lengths and timeouts', () => {
    const d = device();
    d.send(testFrame(hex('01 02 03')));
    d.send(testFrame(hex('01 02 03'), true));
    d.send(Uint8Array.from([0xaa, 0x55, TD_MAX_FRAME + 1]));
    d.send(Uint8Array.from([0xaa, 0x55, 0x05, 0x01]));
    d.advance(1100);
    // CRC-16/MODBUS over 03 01 02 03 = 0xC110 (computed independently in Python).
    expect(d.lines()).toEqual(['ACK C110', 'NAK C110 C111', 'NAK LEN 65', 'NAK TIMEOUT']);
    d.clear();
    d.send('STAT?\n');
    expect(d.lines()[0]).toMatch(/ frames=1 crcerr=1 badframes=2 /);
  });

  it('treats a lone AA as noise and goes on with text', () => {
    const d = device();
    d.send(Uint8Array.from([0xaa, ...ascii('PING 1\n')]));
    expect(d.lines()).toEqual(['PONG 1']);
  });

  it('streams sensor lines, NMEA and Modbus with sequence numbers and optional faults', () => {
    const d = device();
    d.send('STREAM 100\nNMEA 200\nFAULT 2\n');
    expect(d.lines()).toEqual(['OK STREAM 100', 'OK NMEA 200', 'OK FAULT 2']);
    d.clear();
    d.advance(400);
    const lines = d.lines();
    expect(lines.filter((l) => l.startsWith('Temp:'))).toEqual([1, 2, 3, 4].map(sensorLine));
    const nmea = lines.filter((l) => l.startsWith('$'));
    expect(nmea).toEqual([nmeaLine(1, false), nmeaLine(2, true)]);
    expect(nmea.map(isNmeaValid)).toEqual([true, false]);
    d.send('STREAM 0\nNMEA 0\nMODBUS 5\n');
    d.clear();
    d.advance(10);
    expect(isModbusRtuValid(Uint8Array.from(d.out))).toBe(true);
    expect(isModbusRtuValid(modbusFrame(2, true))).toBe(false);
  });

  it('never streams faster than every 10 ms', () => {
    const d = device();
    d.send('STREAM 1\n');
    expect(d.lines()).toEqual(['OK STREAM 10']);
  });

  it('bursts exactly n bytes followed by their CRC', () => {
    const d = device();
    d.send('BURST 300\n');
    const head = ascii('BURST 300\n').length;
    expect(d.out.slice(head, head + 300)).toEqual(Array.from({ length: 300 }, (_, i) => i & 0xff));
    const tail = new TextDecoder().decode(Uint8Array.from(d.out.slice(head + 300)));
    expect(tail).toBe(`BURSTEND ${burstCrc(300).toString(16).toUpperCase().padStart(4, '0')}\n`);
    d.clear();
    d.send('BURST 0\nBURST 99999\n');
    expect(d.lines()).toEqual(['ERR ARG BURST', 'ERR ARG BURST']);
  });

  it('counts, clears and restarts', () => {
    const d = device();
    d.send('PING 1\nBOGUS\nCLEAR\nSTAT?\n');
    expect(d.lines()).toContain('ERR UNKNOWN BOGUS');
    expect(d.lines()[3]).toMatch(/^STAT uptime=0 rxbytes=\d+ txbytes=\d+ lines=1 frames=0/);
    d.clear();
    d.send('RESET\n');
    expect(d.lines()).toEqual(['OK RESET', 'READY SMP-TD/1 board=test fw=1.0']);
    expect(d.restarts()).toBe(1);
  });

  it('keeps the AUTO stream period across restarts', () => {
    let stored = 0;
    let now = 0;
    const out: number[] = [];
    const core = new TestDeviceCore(
      {
        write: (d) => out.push(...d),
        loadAuto: () => stored,
        saveAuto: (ms) => {
          stored = ms;
        },
      },
      () => now,
    );
    core.input(ascii('AUTO 5\nAUTO 50\nRESET\n'));
    for (let i = 0; i < 20; i++) {
      now += 5;
      core.tick();
    }
    const lines = new TextDecoder().decode(Uint8Array.from(out)).split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'OK AUTO 10',
      'OK AUTO 50',
      'OK RESET',
      'READY SMP-TD/1 board=simulator fw=1.0',
    ]);
    expect(lines.filter((l) => l.startsWith('Temp:'))).toHaveLength(2);
    expect(stored).toBe(50);
  });

  it('reports over-long lines instead of executing them', () => {
    const d = device();
    d.send(`ECHO ${'x'.repeat(200)}\n`);
    expect(d.lines()).toEqual(['ERR LONG']);
  });
});
