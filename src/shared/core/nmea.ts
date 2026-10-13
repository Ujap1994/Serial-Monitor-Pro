// NMEA 0183 decoder.

import { t } from '../i18n';

/** XOR over everything between '$' and '*'. */
export function nmeaChecksum(sentence: string): number {
  let cs = 0;
  for (const ch of sentence) cs ^= ch.charCodeAt(0);
  return cs & 0xff;
}

/** Appends the checksum: "GPGGA,..." → "$GPGGA,...*47" */
export function withNmeaChecksum(body: string): string {
  return `$${body}*${nmeaChecksum(body).toString(16).toUpperCase().padStart(2, '0')}`;
}

const TYPES = ['GGA', 'RMC', 'GSA', 'GSV', 'VTG', 'GLL', 'ZDA'] as const;
type NmeaType = (typeof TYPES)[number];

function isKnownType(kind: string): kind is NmeaType {
  return (TYPES as readonly string[]).includes(kind);
}

/** Splits an NMEA sentence and verifies the checksum. */
export function decodeNmea(input: string): string {
  const line = (input ?? '').trim();
  if (!line.startsWith('$')) return t('nmea.notNmea');

  let body: string;
  let checksumState: string;
  const star = line.indexOf('*');
  if (star >= 0) {
    body = line.slice(1, star);
    const given = parseInt(line.slice(star + 1, star + 3), 16);
    if (Number.isNaN(given)) {
      checksumState = t('nmea.checksumUnreadable');
    } else {
      const calc = nmeaChecksum(body);
      checksumState =
        given === calc
          ? t('nmea.checksumOk')
          : t('nmea.checksumBad', {
              given: given.toString(16).toUpperCase().padStart(2, '0'),
              calc: calc.toString(16).toUpperCase().padStart(2, '0'),
            });
    }
  } else {
    body = line.slice(1);
    checksumState = t('nmea.noChecksum');
  }

  const fields = body.split(',');
  const head = fields[0] ?? '';
  const talker = head.slice(0, 2);
  const kind = head.slice(2);
  const desc = isKnownType(kind) ? t(`nmea.type.${kind}`) : t('nmea.unknownType');
  const out = [
    `${head} – ${desc}`,
    `${t('nmea.talker')} ${talker}`,
    t('nmea.fields', { count: fields.length - 1 }),
  ];
  const f = (i: number): string => fields[i] ?? '';

  if (kind === 'GGA' && fields.length >= 10) {
    out.push(`${t('nmea.time')} ${f(1)}`);
    out.push(`${t('nmea.lat')} ${f(2)} ${f(3)}`);
    out.push(`${t('nmea.lon')} ${f(4)} ${f(5)}`);
    out.push(`${t('nmea.satellites')} ${f(7)}`);
    out.push(`${t('nmea.altitude')} ${f(9)} m`);
  } else if (kind === 'RMC' && fields.length >= 8) {
    out.push(`${t('nmea.time')} ${f(1)}`);
    out.push(f(2) === 'A' ? t('nmea.valid') : t('nmea.invalid'));
    out.push(`${t('nmea.lat')} ${f(3)} ${f(4)}`);
    out.push(`${t('nmea.lon')} ${f(5)} ${f(6)}`);
    out.push(`${t('nmea.speed')} ${f(7)} kn`);
  }
  return [...out, checksumState].join('  |  ');
}
