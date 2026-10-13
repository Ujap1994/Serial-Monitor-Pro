import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/i18n';
import { buildModbusFrame, decodeModbusRtu } from '@shared/core/modbus';
import { decodeNmea, nmeaChecksum, withNmeaChecksum } from '@shared/core/nmea';
import { bytes } from './helpers';

beforeAll(() => setLanguage('de'));

describe('Modbus RTU', () => {
  const request = buildModbusFrame(bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x0a));

  it('decodes a request', () => {
    const out = decodeModbusRtu(request);
    expect(out).toContain('Slave 1');
    expect(out).toContain('Read Holding Registers');
    expect(out).toContain('Anfrage: ab Adresse 0, Anzahl 10');
    expect(out).toContain('CRC ✓');
  });

  it('builds the well-known example telegram', () => {
    expect(Array.from(request)).toEqual([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd]);
  });

  it('decodes exception responses', () => {
    const out = decodeModbusRtu(buildModbusFrame(bytes(0x01, 0x83, 0x02)));
    expect(out).toContain('FEHLER');
    expect(out).toContain('Unzulässige Datenadresse');
  });

  it('decodes register values of a response', () => {
    const out = decodeModbusRtu(buildModbusFrame(bytes(0x01, 0x03, 0x04, 0x00, 0x2a, 0x00, 0x64)));
    expect(out).toContain('Antwort');
    expect(out).toContain('[42, 100]');
  });

  it('decodes single writes', () => {
    expect(decodeModbusRtu(buildModbusFrame(bytes(0x01, 0x05, 0x00, 0x07, 0xff, 0x00)))).toContain(
      'Adresse 7 = EIN',
    );
    expect(decodeModbusRtu(buildModbusFrame(bytes(0x01, 0x06, 0x00, 0x02, 0x01, 0x00)))).toContain(
      'Register 2 = 256',
    );
  });

  it('decodes multiple writes (request and response)', () => {
    expect(
      decodeModbusRtu(
        buildModbusFrame(bytes(0x01, 0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0, 1, 0, 2)),
      ),
    ).toContain('Schreiben: ab Adresse 1, Anzahl 2');
    expect(decodeModbusRtu(buildModbusFrame(bytes(0x01, 0x10, 0x00, 0x01, 0x00, 0x02)))).toContain(
      'Geschrieben: ab Adresse 1, Anzahl 2',
    );
  });

  it('reports a wrong checksum', () => {
    const bad = request.slice();
    bad[7] = (bad[7] ?? 0) ^ 0xff;
    expect(decodeModbusRtu(bad)).toContain('CRC ✗');
  });

  it('rejects telegrams that are too short', () => {
    expect(decodeModbusRtu(bytes(0x01))).toContain('zu kurz');
  });
});

describe('NMEA 0183', () => {
  const gga = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';

  it('decodes GGA sentences', () => {
    const out = decodeNmea(gga);
    expect(out).toContain('GPGGA');
    expect(out).toContain('Position und Qualität');
    expect(out).toContain('Prüfsumme ✓');
    expect(out).toContain('Satelliten 08');
    expect(out).toContain('Höhe 545.4 m');
  });

  it('reports a wrong checksum', () => {
    expect(decodeNmea(`${gga.slice(0, -2)}00`)).toContain('Prüfsumme ✗');
  });

  it('recognises foreign text', () => {
    expect(decodeNmea('Hallo')).toContain('kein NMEA');
  });

  it('decodes RMC validity', () => {
    const rmc = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A';
    expect(decodeNmea(rmc)).toContain('gültig');
    expect(decodeNmea(rmc)).toContain('Prüfsumme ✓');
  });

  it('creates sentences with a correct checksum', () => {
    const sentence = withNmeaChecksum(
      'GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,',
    );
    expect(sentence).toBe(gga);
    expect(nmeaChecksum('A')).toBe(0x41);
  });
});
