// Interactive terminal for device consoles (ESP-IDF, Zephyr, U-Boot, Linux …):
// a real VT terminal (xterm.js) – colours, cursor movement, progress bars – and
// every key goes to the device at once.

import { useEffect, useRef, type ReactNode } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { localEcho, terminalBytes } from '@shared/core/terminal';
import { useStore } from '../lib/store';
import { appStore } from '../state/app';
import { monitor, rxBus, sendTerminal } from '../state/serial';

const LIGHT: ITheme = {
  background: '#fbfcfe',
  foreground: '#0f172a',
  cursor: '#2563eb',
  selectionBackground: '#bfdbfe',
  black: '#1f2937',
  red: '#c0392b',
  green: '#1e8449',
  yellow: '#9a7d0a',
  blue: '#1f5fbf',
  magenta: '#8e44ad',
  cyan: '#138d90',
  white: '#6b7280',
  brightBlack: '#4b5563',
  brightRed: '#e74c3c',
  brightGreen: '#27ae60',
  brightYellow: '#b7950b',
  brightBlue: '#2e86de',
  brightMagenta: '#a569bd',
  brightCyan: '#17a5a8',
  brightWhite: '#111827',
};

const DARK: ITheme = {
  background: '#0a1121',
  foreground: '#e5ebf5',
  cursor: '#60a5fa',
  selectionBackground: '#1e3a8a',
  black: '#4b5563',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d1d5db',
  brightBlack: '#9ca3af',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f9fafb',
};

export function TerminalView(): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const dark = useStore(appStore, (s) => s.dark);
  const fontSize = useStore(appStore, (s) => s.settings.fontSize);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      // Many devices end lines with LF only; without this the text would run off to the right.
      convertEol: true,
      scrollback: 10_000,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: appStore.get().settings.fontSize,
      theme: appStore.get().dark ? DARK : LIGHT,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    terminal.current = term;
    const resize = (): void => {
      if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    // What arrived before the terminal was shown.
    for (const e of monitor.all()) if (e.kind === 'rx' && e.raw) term.write(e.raw);

    const offRx = rxBus.on((chunk) => term.write(chunk.data));
    const offReset = monitor.reset.on(() => term.reset());
    const input = term.onData((data) => {
      const s = appStore.get().settings;
      void sendTerminal(terminalBytes(data, s.terminalEnter));
      if (s.terminalEcho) term.write(localEcho(data));
    });
    term.focus();
    return () => {
      input.dispose();
      offRx();
      offReset();
      observer.disconnect();
      terminal.current = null;
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = dark ? DARK : LIGHT;
  }, [dark]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.fontSize = fontSize;
  }, [fontSize]);

  return <div className="terminal-host" ref={host} data-testid="terminal" />;
}
