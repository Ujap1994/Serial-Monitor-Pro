// Runtime of triggers, schedules and macro recording. Definitions are stored in
// the settings; the switches start "off" after every program start, so nothing
// is sent to a device unless the user turns it on.

import { t } from '@shared/i18n';
import {
  dueSchedules,
  MacroRecorder,
  TriggerMatcher,
  type Schedule,
  type Trigger,
} from '@shared/core/automation';
import { newCommand } from '@shared/core/commands';
import { newStep } from '@shared/core/steps';
import { formatTimestamp } from '@shared/core/timestamp';
import { createStore, Emitter } from '../lib/store';
import { appStore, setBusy, setSteps, updateSettings } from './app';
import { isConnected, manualTxBus, rxBus, sendCommand, systemLine } from './serial';

export interface AutomationState {
  triggersOn: boolean;
  schedulerOn: boolean;
  sequenceRunning: boolean;
  recording: boolean;
  /** Number of recorded sends while recording. */
  recorded: number;
  triggerCounts: readonly number[];
  scheduleCounts: readonly number[];
}

export const automationStore = createStore<AutomationState>({
  triggersOn: false,
  schedulerOn: false,
  sequenceRunning: false,
  recording: false,
  recorded: 0,
  triggerCounts: [],
  scheduleCounts: [],
});

/** Lines for the automation log of the page. */
export const automationLog = new Emitter<{ text: string; kind: 'rx' | 'sys' | 'ok' | 'err' }>();

function log(text: string, kind: 'rx' | 'sys' | 'ok' | 'err' = 'sys'): void {
  automationLog.emit({ text: `[${formatTimestamp(Date.now(), 'time-ms')}] ${text}`, kind });
}

function updateBusy(): void {
  const a = automationStore.get();
  setBusy('automation', a.sequenceRunning || a.triggersOn || a.schedulerOn || a.recording);
}

export function setSequenceRunning(running: boolean): void {
  automationStore.set({ sequenceRunning: running });
  updateBusy();
}

function bump(key: 'triggerCounts' | 'scheduleCounts', index: number): void {
  automationStore.set((s) => {
    const counts = [...s[key]];
    counts[index] = (counts[index] ?? 0) + 1;
    return { [key]: counts };
  });
}

// ── Triggers ─────────────────────────────────────────────────────────────────
const matcher = new TriggerMatcher();

export function setTriggers(triggers: Trigger[]): void {
  updateSettings({ triggers });
  matcher.reset();
  automationStore.set({ triggerCounts: [] });
}

export function setTriggersOn(on: boolean): void {
  matcher.reset();
  automationStore.set({ triggersOn: on });
  log(on ? t('trigger.on') : t('trigger.off'), on ? 'ok' : 'sys');
  updateBusy();
}

rxBus.on((chunk) => {
  if (!automationStore.get().triggersOn) return;
  const triggers = appStore.get().settings.triggers;
  for (const i of matcher.push(chunk.data, triggers, performance.now())) {
    const trigger = triggers[i];
    if (!trigger) continue;
    bump('triggerCounts', i);
    const name = trigger.name || t('trigger.unnamed', { n: i + 1 });
    log(t('trigger.fired', { name, response: trigger.response || '—' }), 'ok');
    if (!trigger.response.trim() || !isConnected()) continue;
    void sendCommand(
      newCommand({
        name: `${t('trigger.label')}: ${name}`,
        data: trigger.response,
        fmt: trigger.fmt,
        newline: trigger.newline,
      }),
      true,
    ).then((ok) => {
      if (!ok) log(t('trigger.sendFailed', { name }), 'err');
    });
  }
});

// ── Scheduler ────────────────────────────────────────────────────────────────
const lastRun = new Map<number, number>();
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function setSchedules(schedules: Schedule[]): void {
  updateSettings({ schedules });
  lastRun.clear();
  automationStore.set({ scheduleCounts: [] });
}

function schedulerTick(): void {
  if (!isConnected()) return;
  const schedules = appStore.get().settings.schedules;
  for (const i of dueSchedules(schedules, lastRun, performance.now())) {
    const s = schedules[i];
    if (!s || !s.data.trim()) continue;
    bump('scheduleCounts', i);
    const name = s.name || t('schedule.unnamed', { n: i + 1 });
    log(t('schedule.sent', { name }));
    void sendCommand(newCommand({ name, data: s.data, fmt: s.fmt, newline: s.newline }), true).then(
      (ok) => {
        if (!ok) log(t('schedule.sendFailed', { name }), 'err');
      },
    );
  }
}

export function setSchedulerOn(on: boolean): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  lastRun.clear();
  automationStore.set({ schedulerOn: on });
  log(on ? t('schedule.on') : t('schedule.off'), on ? 'ok' : 'sys');
  if (on) {
    schedulerTick();
    schedulerTimer = setInterval(schedulerTick, 250);
  }
  updateBusy();
}

// ── Macro recording ──────────────────────────────────────────────────────────
const recorder = new MacroRecorder();
let recordOff: (() => void) | null = null;

export function startRecording(): void {
  if (automationStore.get().recording) return;
  recorder.start(performance.now());
  recordOff = manualTxBus.on(({ data, t: time }) => {
    recorder.record(data, time);
    automationStore.set({ recorded: recorder.count });
  });
  automationStore.set({ recording: true, recorded: 0 });
  log(t('macro.started'), 'ok');
  systemLine(t('macro.started'));
  updateBusy();
}

/** Ends the recording and appends the recorded steps to the sequence. */
export function stopRecording(): number {
  if (!automationStore.get().recording) return 0;
  recordOff?.();
  recordOff = null;
  const steps = recorder.stop();
  const sends = steps.filter((s) => s.kind === 'send').length;
  automationStore.set({ recording: false, recorded: 0 });
  if (sends) {
    const note = newStep({
      kind: 'log',
      note: t('macro.note', { time: formatTimestamp(Date.now(), 'datetime') }),
    });
    setSteps([...appStore.get().steps, note, ...steps]);
  }
  const text = sends ? t('macro.stopped', { count: sends }) : t('macro.empty');
  log(text, sends ? 'ok' : 'sys');
  systemLine(text);
  updateBusy();
  return sends;
}
