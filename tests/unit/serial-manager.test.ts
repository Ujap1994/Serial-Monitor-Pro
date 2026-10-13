import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import { printableRatio } from '@shared/core/baudscan';
import { calculateCrc } from '@shared/core/crc';
import { buildModbusFrame, decodeModbusRtu } from '@shared/core/modbus';
import { decodeNmea } from '@shared/core/nmea';
import type { SerialEvent } from '@shared/ipc';
import { classifyError, listPorts, SerialManager } from '../../src/main/serial';
import { SENSOR_BAUD, simulatedPorts } from '../../src/main/simulator';
import { ascii, bytes } from './helpers';

beforeAll(() => setLanguage('en'));

const options = (path: string, baudRate = 115200) =>
  ({ path, baudRate, dataBits: 8, parity: 'None', stopBits: '1' }) as const;

function collect() {
  const events: SerialEvent[] = [];
  const manager = new SerialManager((e) => events.push(e));
  const received = (id: string): Uint8Array => {
    const parts = events.flatMap((e) =>
      e.kind === 'data' && e.id === id ? e.chunks.map((c) => c.data) : [],
    );
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  };
  return { events, manager, received };
}

let active: SerialManager | null = null;
afterEach(async () => {
  await active?.closeAll();
  active = null;
});

describe('SerialManager with simulated devices', () => {
  it('lists the simulated devices only on request', async () => {
    const withSim = await listPorts(true);
    const withoutSim = await listPorts(false);
    for (const sim of simulatedPorts()) expect(withSim.map((p) => p.path)).toContain(sim.path);
    expect(withoutSim.some((p) => p.simulated)).toBe(false);
  });

  it('echoes data on the loopback device', async () => {
    const { manager, received } = collect();
    active = manager;
    expect(await manager.open('main', options('sim:loopback'))).toEqual({ ok: true });
    expect(await manager.write('main', ascii('ping'))).toEqual({ ok: true });
    await expect.poll(() => new TextDecoder().decode(received('main'))).toBe('ping');
  });

  it('reports the end of a connection exactly once', async () => {
    const { events, manager } = collect();
    await manager.open('main', options('sim:loopback'));
    await manager.close('main');
    await manager.close('main');
    expect(events.filter((e) => e.kind === 'closed')).toEqual([
      { kind: 'closed', id: 'main', path: 'sim:loopback', lost: false },
    ]);
  });

  it('refuses to open the same port twice', async () => {
    const { manager } = collect();
    active = manager;
    await manager.open('main', options('sim:loopback'));
    const second = await manager.open('mp0', options('sim:loopback'));
    expect(second).toMatchObject({ ok: false, code: 'in-use' });
  });

  it('fails cleanly for unknown ports', async () => {
    const { manager } = collect();
    const result = await manager.open('main', options('sim:nothing'));
    expect(result).toMatchObject({ ok: false, code: 'not-found' });
    expect(await manager.write('main', ascii('x'))).toMatchObject({ ok: false });
  });

  it('sends readable sensor lines only at the right baud rate', async () => {
    const { manager } = collect();
    const good = await manager.sample('sim:sensor', SENSOR_BAUD, 800);
    const bad = await manager.sample('sim:sensor', 115200, 800);
    expect(good.ok && printableRatio(good.value)).toBe(1);
    expect(good.ok && new TextDecoder().decode(good.value)).toMatch(/Temp:\d+\.\d+, Humidity:/);
    expect(bad.ok && printableRatio(bad.value)).toBeLessThan(0.2);
  });

  it('answers AT commands on the sensor', async () => {
    const { manager, received } = collect();
    active = manager;
    await manager.open('main', options('sim:sensor', SENSOR_BAUD));
    await manager.write('main', ascii('AT\r\n'));
    await expect.poll(() => new TextDecoder().decode(received('main'))).toContain('OK\r\n');
  });

  it('answers Modbus requests like a real slave', async () => {
    const { manager, received } = collect();
    active = manager;
    await manager.open('main', options('sim:modbus'));
    await manager.write('main', buildModbusFrame(bytes(0x01, 0x03, 0x00, 0x01, 0x00, 0x02)));
    await expect.poll(() => received('main').length).toBe(9);
    const answer = received('main');
    expect(decodeModbusRtu(answer)).toContain('Response: 2 registers [10, 20]');
    expect(decodeModbusRtu(answer)).toContain('CRC ✓');
  });

  it('rejects illegal Modbus addresses with an exception', async () => {
    const { manager, received } = collect();
    active = manager;
    await manager.open('main', options('sim:modbus'));
    await manager.write('main', buildModbusFrame(bytes(0x01, 0x03, 0x00, 0x63, 0x00, 0x05)));
    await expect.poll(() => decodeModbusRtu(received('main'))).toContain('Illegal data address');
  });

  it('emits valid NMEA sentences', async () => {
    const { manager } = collect();
    const sample = await manager.sample('sim:gps', 9600, 700);
    expect(sample.ok).toBe(true);
    const lines = sample.ok ? new TextDecoder().decode(sample.value).trim().split('\r\n') : [];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(decodeNmea(line)).toContain('Checksum ✓');
  });

  it('emits binary telegrams with CRC-8', async () => {
    const { manager } = collect();
    const sample = await manager.sample('sim:frames', 115200, 1000);
    const data = sample.ok ? sample.value : new Uint8Array();
    expect(Array.from(data.subarray(0, 3))).toEqual([0xaa, 0x55, 3]);
    expect(data[6]).toBe(calculateCrc(data.subarray(0, 6), 'CRC-8'));
  });
});

describe('classifyError', () => {
  it.each([
    ['Error: Permission denied, cannot open /dev/ttyUSB0', 'permission'],
    ['Opening COM3: Access denied', 'permission'],
    ['Error: No such file or directory, cannot open /dev/ttyUSB9', 'not-found'],
    ['Opening COM9: File not found', 'not-found'],
    ['Error: Resource temporarily unavailable Cannot lock port', 'busy'],
    ['something odd', 'unknown'],
  ])('%s → %s', (message, code) => {
    expect(classifyError(message)).toBe(code);
  });
});
