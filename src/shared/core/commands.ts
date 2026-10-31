// Stored commands. Presets and the send table deliberately share one list:
// whatever is created once is available in both places.

import { t } from '../i18n';
import { concatBytes, hex2 } from './bytes';
import { InputError, isDataFormat, parseSendData, type DataFormat } from './format';
import { isNewline, NEWLINE_BYTES, type Newline } from './newline';
import { DEFAULT_TRANSMIT_CRC, insertCrc, type TransmitCrcConfig } from './transmit-crc';

export { isNewline, NEWLINE_BYTES, NEWLINES, type Newline } from './newline';

export interface Command {
  name: string;
  data: string;
  fmt: DataFormat;
  newline: Newline;
  /** Pause after this command when a sequence is processed. */
  delayMs: number;
  /** Taken into account by the send table. */
  enabled: boolean;
  /**
   * Append the CRC configured in the CRC tab (algorithm, byte order, position) –
   * "Add CRC" of the former Python presets. Header/footer of the Monitor are not added.
   */
  addCrc: boolean;
  /** Free text (Python: "description"). */
  description: string;
  /** Pause of periodic sending of this command (Python: "periodic_ms"). */
  periodicMs: number;
}

export function newCommand(partial: Partial<Command> = {}): Command {
  return {
    name: '',
    data: '',
    fmt: 'HEX',
    newline: 'LF',
    delayMs: 200,
    enabled: true,
    addCrc: false,
    description: '',
    periodicMs: 1000,
    ...partial,
  };
}

/**
 * Final bytes including the CRC (when the command asks for it) and the line
 * ending. Throws {@link InputError}.
 */
export function commandBytes(
  cmd: Command,
  crc: Readonly<TransmitCrcConfig> = DEFAULT_TRANSMIT_CRC,
): Uint8Array {
  let data = parseSendData(cmd.data, cmd.fmt);
  if (cmd.addCrc && data.length) data = insertCrc(data, crc).data;
  return concatBytes(data, NEWLINE_BYTES[cmd.newline]);
}

/** Short preview of the bytes that will actually be sent. */
export function commandPreview(
  cmd: Command,
  crc: Readonly<TransmitCrcConfig> = DEFAULT_TRANSMIT_CRC,
): string {
  let raw: Uint8Array;
  try {
    raw = commandBytes(cmd, crc);
  } catch (err) {
    return `⚠ ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!raw.length) return '—';
  const shown = Array.from(raw.subarray(0, 12), hex2).join(' ');
  return `${shown}${raw.length > 12 ? ' …' : ''}   (${raw.length} B)`;
}

export function validateCommand(
  cmd: Command,
  crc: Readonly<TransmitCrcConfig> = DEFAULT_TRANSMIT_CRC,
): { ok: boolean; error: string } {
  if (!cmd.name.trim()) return { ok: false, error: t('command.nameMissing') };
  try {
    commandBytes(cmd, crc);
  } catch (err) {
    return { ok: false, error: err instanceof InputError ? err.message : String(err) };
  }
  return { ok: true, error: '' };
}

/** Text value of a JSON field (numbers are accepted, objects are not). */
function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function int(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/**
 * Normalises one command from a file. Accepts the field names of the former
 * Python version (`delay_ms`, `add_crc`, `periodic_ms`) as well, so existing exports keep working.
 */
export function normalizeCommand(value: unknown): Command {
  const d = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    name: text(d.name),
    data: text(d.data),
    fmt: isDataFormat(d.fmt) ? d.fmt : 'HEX',
    newline: isNewline(d.newline) ? d.newline : 'LF',
    delayMs: int(d.delayMs ?? d.delay_ms, 200),
    enabled: typeof d.enabled === 'boolean' ? d.enabled : true,
    addCrc: (d.addCrc ?? d.add_crc) === true,
    description: text(d.description),
    periodicMs: Math.min(3_600_000, Math.max(10, int(d.periodicMs ?? d.periodic_ms, 1000))),
  };
}

/** Parses an import file. Throws if the file holds no command list. */
export function parseCommandFile(json: string): Command[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new InputError(t('command.importInvalid'));
  }
  if (!Array.isArray(raw)) throw new InputError(t('command.importInvalid'));
  return raw.map(normalizeCommand);
}

export function serializeCommands(cmds: Command[]): string {
  return JSON.stringify(cmds, null, 2);
}
