// Stored commands. Presets and the send table deliberately share one list:
// whatever is created once is available in both places.

import { t } from '../i18n';
import { concatBytes, hex2 } from './bytes';
import { InputError, isDataFormat, parseSendData, type DataFormat } from './format';

export const NEWLINES = ['None', 'LF', 'CR', 'CRLF'] as const;
export type Newline = (typeof NEWLINES)[number];

export const NEWLINE_BYTES: Record<Newline, Uint8Array> = {
  None: new Uint8Array(),
  LF: Uint8Array.of(0x0a),
  CR: Uint8Array.of(0x0d),
  CRLF: Uint8Array.of(0x0d, 0x0a),
};

export function isNewline(value: unknown): value is Newline {
  return typeof value === 'string' && (NEWLINES as readonly string[]).includes(value);
}

export interface Command {
  name: string;
  data: string;
  fmt: DataFormat;
  newline: Newline;
  /** Pause after this command when a sequence is processed. */
  delayMs: number;
  /** Taken into account by the send table. */
  enabled: boolean;
}

export function newCommand(partial: Partial<Command> = {}): Command {
  return { name: '', data: '', fmt: 'HEX', newline: 'LF', delayMs: 200, enabled: true, ...partial };
}

/** Final bytes including the line ending. Throws {@link InputError}. */
export function commandBytes(cmd: Command): Uint8Array {
  return concatBytes(parseSendData(cmd.data, cmd.fmt), NEWLINE_BYTES[cmd.newline]);
}

/** Short preview of the bytes that will actually be sent. */
export function commandPreview(cmd: Command): string {
  let raw: Uint8Array;
  try {
    raw = commandBytes(cmd);
  } catch (err) {
    return `⚠ ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!raw.length) return '—';
  const shown = Array.from(raw.subarray(0, 12), hex2).join(' ');
  return `${shown}${raw.length > 12 ? ' …' : ''}   (${raw.length} B)`;
}

export function validateCommand(cmd: Command): { ok: boolean; error: string } {
  if (!cmd.name.trim()) return { ok: false, error: t('command.nameMissing') };
  try {
    commandBytes(cmd);
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
 * Python version (`delay_ms`) as well, so existing exports keep working.
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
