// Dialogs and toast notifications.

import type { ReactNode } from 'react';
import { createStore } from '../lib/store';
import type { Tone } from './app';

export type GlobalDialog = 'settings' | 'about' | 'baudscan' | 'shortcuts';

export interface Choice<T> {
  label: string;
  value: T;
  variant?: 'primary' | 'danger' | 'default';
}

export interface ModalRequest {
  id: number;
  title: string;
  text: ReactNode;
  tone: Tone;
  choices: Choice<unknown>[];
  /** Value returned when the dialog is dismissed with Escape. */
  cancelValue: unknown;
  resolve: (value: unknown) => void;
}

export interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

interface UiState {
  dialog: GlobalDialog | null;
  modals: ModalRequest[];
  toasts: Toast[];
}

export const uiStore = createStore<UiState>({ dialog: null, modals: [], toasts: [] });

let nextId = 1;

export function openDialog(dialog: GlobalDialog | null): void {
  uiStore.set({ dialog });
}

export function choose<T>(
  title: string,
  text: ReactNode,
  choices: Choice<T>[],
  cancelValue: T,
  tone: Tone = 'info',
): Promise<T> {
  return new Promise((resolve) => {
    const request: ModalRequest = {
      id: nextId++,
      title,
      text,
      tone,
      choices,
      cancelValue,
      resolve: (value) => {
        uiStore.set((s) => ({ modals: s.modals.filter((m) => m.id !== request.id) }));
        resolve(value as T);
      },
    };
    uiStore.set((s) => ({ modals: [...s.modals, request] }));
  });
}

export function alertDialog(title: string, text: ReactNode, tone: Tone = 'info'): Promise<void> {
  return choose(
    title,
    text,
    [{ label: 'OK', value: undefined, variant: 'primary' }],
    undefined,
    tone,
  );
}

export function confirmDialog(
  title: string,
  text: ReactNode,
  okLabel: string,
  cancelLabel: string,
  danger = false,
): Promise<boolean> {
  return choose(
    title,
    text,
    [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
    false,
    danger ? 'warn' : 'info',
  );
}

export function toast(text: string, tone: Tone = 'info', ms = 3200): void {
  const id = nextId++;
  uiStore.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
  setTimeout(() => uiStore.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
}
