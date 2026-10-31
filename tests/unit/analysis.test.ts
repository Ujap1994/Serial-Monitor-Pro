import { describe, expect, it } from 'vitest';
import {
  decodeModbusAscii,
  decodeModbusRtu,
  isModbusAsciiValid,
  isModbusRtuValid,
  modbusLrc,
  parseModbusAscii,
} from '@shared/core/modbus';
import { isNmeaValid } from '@shared/core/nmea';
import { seriesCsv, seriesStats } from '@shared/core/values';
import { hex } from './helpers';

describe('graph statistics', () => {
  it('computes count, min, max, mean, population std. dev., median and range', () => {
    expect(seriesStats([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({
      count: 8,
      min: 2,
      max: 9,
      mean: 5,
      stddev: 2,
      median: 4.5,
      range: 7,
    });
    expect(seriesStats([3, 1, 2])?.median).toBe(2);
    expect(seriesStats([])).toBeNull();
  });

  it('exports curves right-aligned like the plot', () => {
    const csv = seriesCsv(
      new Map([
        ['Temp', [20, 21, 22]],
        ['Hum;id', [50]],
      ]),
      'Index',
    );
    expect(csv).toBe('\uFEFFIndex;Temp;"Hum;id"\r\n0;20;\r\n1;21;\r\n2;22;50\r\n');
  });
});

describe('Modbus ASCII (as in the Python version)', () => {
  it("computes the LRC as the two's complement of the byte sum", () => {
    expect(modbusLrc(hex('01 03 00 00 00 0A'))).toBe(0xf2);
    expect(modbusLrc(hex('11 03 00 6B 00 03'))).toBe(0x7e);
  });

  it('parses ":" + hex pairs with or without CR LF', () => {
    expect(parseModbusAscii(':01030000000AF2\r\n')).toEqual(hex('01 03 00 00 00 0A F2'));
    expect(parseModbusAscii('01030000000AF2')).toBeNull();
    expect(parseModbusAscii(':0103X')).toBeNull();
    expect(parseModbusAscii(':010')).toBeNull();
  });

  it('decodes like Modbus RTU, with the LRC instead of the CRC', () => {
    const ascii = decodeModbusAscii(':01030000000AF2');
    expect(ascii).toContain('Read Holding Registers');
    expect(ascii).toContain('LRC ✓');
    expect(ascii.replace('LRC ✓', '')).toBe(
      decodeModbusRtu(hex('01 03 00 00 00 0A C5 CD')).replace('CRC ✓', ''),
    );
    expect(decodeModbusAscii(':01030000000AF3')).toContain('LRC ✗');
    expect(isModbusAsciiValid(':01030000000AF2')).toBe(true);
    expect(isModbusAsciiValid(':01030000000AF3')).toBe(false);
    expect(isModbusAsciiValid('$GPGGA')).toBe(false);
  });
});

describe('protocol validity', () => {
  it('checks the Modbus RTU CRC', () => {
    expect(isModbusRtuValid(hex('01 03 00 00 00 0A C5 CD'))).toBe(true);
    expect(isModbusRtuValid(hex('01 03 00 00 00 0A C5 CE'))).toBe(false);
    expect(isModbusRtuValid(hex('01 03 00'))).toBe(false);
  });

  it('checks NMEA checksums; sentences without one count as valid', () => {
    expect(isNmeaValid('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47')).toBe(
      true,
    );
    expect(isNmeaValid('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*48')).toBe(
      false,
    );
    expect(isNmeaValid('$GPGGA,1*ZZ')).toBe(false);
    expect(isNmeaValid('$GPTXT,hello')).toBe(true);
    expect(isNmeaValid('GPGGA')).toBe(false);
  });
});
