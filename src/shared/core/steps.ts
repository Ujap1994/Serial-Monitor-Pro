// Steps of an automation sequence.

import { t } from '../i18n';
import { isDataFormat, type DataFormat } from './format';
import { isNewline, type Newline } from './commands';

export const STEP_KINDS = ['send', 'wait', 'expect', 'log'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface Step {
  kind: StepKind;
  /** send/expect: payload or pattern. */
  data: string;
  fmt: DataFormat;
  newline: Newline;
  /** wait: duration in ms; expect: timeout in ms. */
  value: number;
  /** log: text for the protocol. */
  note: string;
}

export function newStep(partial: Partial<Step> = {}): Step {
  return { kind: 'send', data: '', fmt: 'HEX', newline: 'LF', value: 500, note: '', ...partial };
}

export function describeStep(step: Step): string {
  switch (step.kind) {
    case 'send':
      return t('step.describe.send', {
        fmt: step.fmt,
        data: step.data || '—',
        newline: step.newline,
      });
    case 'wait':
      return t('step.describe.wait', { ms: step.value });
    case 'expect':
      return t('step.describe.expect', { data: step.data, ms: step.value });
    case 'log':
      return t('step.describe.log', { note: step.note });
  }
}

/** Text value of a JSON field (numbers are accepted, objects are not). */
function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function normalizeStep(value: unknown): Step {
  const d = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const kind = (STEP_KINDS as readonly string[]).includes(String(d.kind))
    ? (d.kind as StepKind)
    : 'send';
  const n = Number(d.value);
  return {
    kind,
    data: text(d.data),
    fmt: isDataFormat(d.fmt) ? d.fmt : 'HEX',
    newline: isNewline(d.newline) ? d.newline : 'LF',
    value: Number.isFinite(n) && n >= 0 ? Math.round(n) : 500,
    note: text(d.note),
  };
}
