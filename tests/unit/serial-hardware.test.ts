// Loopback test through the application's own serial code with real hardware.
// It only runs when a port is named explicitly – it must never talk to a
// device that just happens to be plugged in (a measuring instrument, say):
//
//   SMP_HW_PORT=/dev/ttyUSB0 npx vitest run tests/unit/serial-hardware.test.ts
//   SMP_HW_PORT=COM3 SMP_HW_BAUDS=9600,115200 npx vitest run tests/unit/serial-hardware.test.ts
//
// Connect TX and RX of the adapter (loopback jumper). Every byte value is sent
// at several baud rates and frame formats and has to come back unchanged.

import { afterEach, describe, expect, it } from 'vitest';
import type { DataBits, Parity, StopBits } from '@shared/core/settings';
import type { SerialEvent } from '@shared/ipc';
import { SerialManager } from '../../src/main/serial';

const path = process.env.SMP_HW_PORT;
const bauds = (process.env.SMP_HW_BAUDS ?? '9600,57600,115200,460800').split(',').map(Number);
const formats: { name: string; dataBits: DataBits; parity: Parity; stopBits: StopBits }[] = [
  { name: '8N1', dataBits: 8, parity: 'None', stopBits: '1' },
  { name: '8E1', dataBits: 8, parity: 'Even', stopBits: '1' },
  { name: '8O2', dataBits: 8, parity: 'Odd', stopBits: '2' },
  { name: '7E1', dataBits: 7, parity: 'Even', stopBits: '1' },
];

let manager: SerialManager | null = null;
afterEach(async () => {
  await manager?.closeAll();
  manager = null;
});

describe.skipIf(!path)(`real hardware loopback on ${path ?? '(no SMP_HW_PORT)'}`, () => {
  for (const baudRate of bauds) {
    for (const format of formats) {
      it(`${baudRate} baud ${format.name}`, async () => {
        let received: number[] = [];
        manager = new SerialManager((e: SerialEvent) => {
          if (e.kind === 'data') for (const c of e.chunks) received.push(...c.data);
        });
        const result = await manager.open('hw', { path: path ?? '', baudRate, ...format });
        expect(result, 'open').toEqual({ ok: true });
        // With 7 data bits only 0x00…0x7F can travel.
        const values = format.dataBits === 7 ? 128 : 256;
        const payload = Uint8Array.from({ length: 1024 }, (_, i) => i % values);
        received = [];
        // Block by block, each echoed before the next. Simple adapters have tiny
        // buffers – the ATmega16U2 of an Arduino Uno (128 bytes) loses and
        // repeats data under sustained load above 115200 baud – and this test
        // is about the application, not the adapter. Sustained throughput is
        // what `npm run test:hardware` measures.
        const block = 32;
        for (let off = 0; off < payload.length; off += block) {
          const part = payload.subarray(off, off + block);
          expect(await manager.write('hw', part)).toEqual({ ok: true });
          await expect
            .poll(() => received.length, { interval: 1, timeout: 1000 })
            .toBe(off + part.length);
        }
        expect(received).toEqual(Array.from(payload));
      }, 20_000);
    }
  }
});
