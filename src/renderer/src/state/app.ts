// Global application state: settings, stored commands, automation steps,
// available ports and the connection of the monitor.

import { resolveLanguage, setLanguage, type Language } from '@shared/i18n';
import { normalizeCommand, type Command } from '@shared/core/commands';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@shared/core/settings';
import { normalizeStep, type Step } from '@shared/core/steps';
import type { AppInfo, PortInfo } from '@shared/ipc';
import { createStore } from '../lib/store';

export const TABS = [
  'monitor',
  'presets',
  'crc',
  'stop',
  'protocol',
  'automation',
  'multiport',
  'sendtable',
  'frameparser',
  'graph',
] as const;
export type TabId = (typeof TABS)[number];

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export type Tone = 'info' | 'ok' | 'warn' | 'error';

export interface AppState {
  ready: boolean;
  info: AppInfo | null;
  settings: Settings;
  language: Language;
  dark: boolean;
  commands: Command[];
  steps: Step[];
  ports: PortInfo[];
  connection: ConnectionState;
  connectedPath: string;
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  status: { text: string; tone: Tone };
  tab: TabId;
  /** Tabs with a running activity (sequence, automation, stop watch …). */
  busyTabs: readonly TabId[];
}

export const appStore = createStore<AppState>({
  ready: false,
  info: null,
  settings: { ...DEFAULT_SETTINGS },
  language: 'en',
  dark: false,
  commands: [],
  steps: [],
  ports: [],
  connection: 'disconnected',
  connectedPath: '',
  rxBytes: 0,
  txBytes: 0,
  rxRate: 0,
  txRate: 0,
  status: { text: '', tone: 'info' },
  tab: 'monitor',
  busyTabs: [],
});

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(settings: Settings): void {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--mono-size', `${settings.fontSize}px`);
  window.smp.app.setTheme(settings.theme);
  if (appStore.get().dark !== dark) appStore.set({ dark });
}

function applyLanguage(settings: Settings): void {
  const lang = resolveLanguage(
    settings.language,
    appStore.get().info?.locale ?? navigator.language,
  );
  setLanguage(lang);
  document.documentElement.lang = lang;
  window.smp.app.setLanguage(lang);
  if (appStore.get().language !== lang) appStore.set({ language: lang });
}

darkQuery.addEventListener('change', () => applyTheme(appStore.get().settings));

// ── Persistence (debounced, so typing in a field does not hammer the disk) ──
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function persist(
  name: 'settings' | 'commands' | 'automation',
  data: () => unknown,
  delay = 300,
): void {
  clearTimeout(timers.get(name));
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name);
      void window.smp.store.save(name, data());
    }, delay),
  );
}

/** Writes pending changes immediately (used before the window closes). */
export function flushPersistence(): void {
  const s = appStore.get();
  for (const [name, timer] of timers) {
    clearTimeout(timer);
    if (name === 'settings') void window.smp.store.save('settings', s.settings);
    if (name === 'commands') void window.smp.store.save('commands', s.commands);
    if (name === 'automation') void window.smp.store.save('automation', s.steps);
  }
  timers.clear();
}

export function updateSettings(patch: Partial<Settings>): void {
  const before = appStore.get().settings;
  const settings = normalizeSettings({ ...before, ...patch });
  appStore.set({ settings });
  if (settings.theme !== before.theme || settings.fontSize !== before.fontSize)
    applyTheme(settings);
  if (settings.language !== before.language) applyLanguage(settings);
  persist('settings', () => appStore.get().settings);
}

export function setCommands(commands: Command[]): void {
  appStore.set({ commands });
  persist('commands', () => appStore.get().commands, 50);
}

export function setSteps(steps: Step[]): void {
  appStore.set({ steps });
  persist('automation', () => appStore.get().steps, 50);
}

export function setStatus(text: string, tone: Tone = 'info'): void {
  appStore.set({ status: { text, tone } });
}

export function setTab(tab: TabId): void {
  appStore.set({ tab });
}

export function setBusy(tab: TabId, busy: boolean): void {
  const current = appStore.get().busyTabs;
  if (busy === current.includes(tab)) return;
  appStore.set({ busyTabs: busy ? [...current, tab] : current.filter((t) => t !== tab) });
}

export async function initApp(): Promise<void> {
  const [info, rawSettings, rawCommands, rawSteps] = await Promise.all([
    window.smp.app.info(),
    window.smp.store.load('settings'),
    window.smp.store.load('commands'),
    window.smp.store.load('automation'),
  ]);
  const settings = normalizeSettings(rawSettings ?? {});
  if (info.simulatorForced) settings.simulator = true;
  appStore.set({
    info,
    settings,
    commands: Array.isArray(rawCommands) ? rawCommands.map(normalizeCommand) : [],
    steps: Array.isArray(rawSteps) ? rawSteps.map(normalizeStep) : [],
  });
  applyLanguage(settings);
  applyTheme(settings);
  appStore.set({ ready: true });
}
