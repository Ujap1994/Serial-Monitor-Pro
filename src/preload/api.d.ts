import type { SmpApi } from '../shared/ipc';

declare global {
  interface Window {
    smp: SmpApi;
  }
}

export {};
