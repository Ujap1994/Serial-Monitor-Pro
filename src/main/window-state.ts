// Remembers size, position and maximised state of the main window.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, type BrowserWindow, type Rectangle } from 'electron';

interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const DEFAULT: WindowState = { bounds: { x: 0, y: 0, width: 1360, height: 860 }, maximized: false };

function visibleOnSomeDisplay(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return overlapX >= 120 && overlapY >= 80;
  });
}

export function loadWindowState(dir: string): WindowState & { centered: boolean } {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'window-state.json'), 'utf8')) as WindowState;
    const b = raw.bounds;
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite) && visibleOnSomeDisplay(b)) {
      return { bounds: b, maximized: Boolean(raw.maximized), centered: false };
    }
  } catch {
    // first start or unreadable – use defaults
  }
  return { ...DEFAULT, centered: true };
}

export function trackWindowState(win: BrowserWindow, dir: string): void {
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      writeFileSync(join(dir, 'window-state.json'), JSON.stringify(state));
    } catch {
      // not critical
    }
  };
  win.on('close', save);
}
