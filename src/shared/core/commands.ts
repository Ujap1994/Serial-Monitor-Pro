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
  /**
   * Sequence mode of the Python presets ("is_sequence"): instead of `data`, the
   * steps are sent one after another, each followed by its pause. The command's
   * line ending and "Append CRC" apply to every step.
   */
  sequence: boolean;
  steps: CommandStep[];
}

export interface CommandStep {
  data: string;
  fmt: DataFormat;
  /** Pause after this step (Python: "pause_ms"). */
  pauseMs: number;
}

/** One write of a command: the bytes and the pause after them. */
export interface CommandPart {
  data: Uint8Array;
  pauseMs: number;
}

export const MAX_STEP_PAUSE_MS = 600_000;

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
    sequence: false,
    steps: [],
    ...partial,
  };
}

/**
 * The writes of a command in order – one for a normal command, one per step in
 * sequence mode. Each part includes the CRC (when asked for) and the line
 * ending. Throws {@link InputError}, naming the step in sequence mode.
 */
export function commandParts(
  cmd: Command,
  crc: Readonly<TransmitCrcConfig> = DEFAULT_TRANSMIT_CRC,
): CommandPart[] {
  const build = (text: string, fmt: DataFormat): Uint8Array => {
    let data = parseSendData(text, fmt);
    if (cmd.addCrc && data.length) data = insertCrc(data, crc).data;
    return concatBytes(data, NEWLINE_BYTES[cmd.newline]);
  };
  if (!cmd.sequence) return [{ data: build(cmd.data, cmd.fmt), pauseMs: 0 }];
  if (!cmd.steps.length) throw new InputError(t('command.stepsMissing'));
  return cmd.steps.map((step, i) => {
    try {
      return { data: build(step.data, step.fmt), pauseMs: step.pauseMs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InputError(t('command.stepError', { n: i + 1, message }));
    }
  });
}

/**
 * Final bytes including the CRC (when the command asks for it) and the line
 * ending. Throws {@link InputError}.
 */
export function commandBytes(
  cmd: Command,
  crc: Readonly<TransmitCrcConfig> = DEFAULT_TRANSMIT_CRC,
): Uint8Array {
  return concatBytes(...commandParts(cmd, crc).map((p) => p.data));
}

/** Short preview of the bytes that will actually be sent. */
export function commandPreview(
  cmd: Command,
  crc: Readonly<TransmitCrcConfig> = DEFAULT_TRANSMIT_CRC,
): string {
  let parts: CommandPart[];
  try {
    parts = commandParts(cmd, crc);
  } catch (err) {
    return `⚠ ${err instanceof Error ? err.message : String(err)}`;
  }
  const raw = concatBytes(...parts.map((p) => p.data));
  if (!raw.length) return '—';
  const shown = Array.from(raw.subarray(0, 12), hex2).join(' ');
  const size = `${shown}${raw.length > 12 ? ' …' : ''}   (${raw.length} B)`;
  return cmd.sequence ? `${t('command.stepsCount', { count: parts.length })} · ${size}` : size;
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

function normalizeStep(value: unknown): CommandStep {
  const d = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const fmt = d.fmt ?? d.format;
  return {
    data: text(d.data),
    fmt: isDataFormat(fmt) ? fmt : 'HEX',
    pauseMs: Math.min(MAX_STEP_PAUSE_MS, int(d.pauseMs ?? d.pause_ms, 0)),
  };
}

/**
 * Normalises one command from a file. Accepts the field names of the former
 * Python versions as well (`format`, `delay_ms`, `add_crc`, `periodic_ms`,
 * `is_sequence`, `steps` with `pause_ms`), so existing exports keep working.
 */
export function normalizeCommand(value: unknown): Command {
  const d = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const fmt = d.fmt ?? d.format;
  const steps = Array.isArray(d.steps) ? d.steps.slice(0, 500).map(normalizeStep) : [];
  return {
    name: text(d.name),
    data: text(d.data),
    fmt: isDataFormat(fmt) ? fmt : 'HEX',
    newline: isNewline(d.newline) ? d.newline : 'LF',
    delayMs: int(d.delayMs ?? d.delay_ms, 200),
    enabled: typeof d.enabled === 'boolean' ? d.enabled : true,
    addCrc: (d.addCrc ?? d.add_crc) === true,
    description: text(d.description),
    periodicMs: Math.min(3_600_000, Math.max(10, int(d.periodicMs ?? d.periodic_ms, 1000))),
    sequence: (d.sequence ?? d.is_sequence) === true,
    steps,
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
