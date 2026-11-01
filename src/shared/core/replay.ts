// Plays a session capture back as a device.
//
//  - "answer": behaves like the recorded device – whenever the application
//    sends what was sent in the capture, the recorded answer follows with its
//    recorded delay. A request that comes in a different order is found again
//    in the capture (polling devices are asked the same thing many times).
//  - "timed": plays everything the device sent on its original timeline and
//    ignores what the application sends (streams, logs, boot messages).

import { concatBytes } from './bytes';
import type { CaptureEvent } from './capture';

export type ReplayMode = 'answer' | 'timed';

export interface ReplayOptions {
  mode: ReplayMode;
  /** 1 = original speed, 2 = twice as fast … */
  speed: number;
  /** "timed": start again at the end. ("answer" always continues with the first request.) */
  loop: boolean;
}

export const DEFAULT_REPLAY: Readonly<ReplayOptions> = Object.freeze({
  mode: 'answer',
  speed: 1,
  loop: true,
});

export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 5, 10] as const;

export function normalizeReplayOptions(raw: Partial<ReplayOptions> | undefined): ReplayOptions {
  const speed = Number(raw?.speed);
  return {
    mode: raw?.mode === 'timed' ? 'timed' : 'answer',
    speed: Number.isFinite(speed) && speed >= 0.05 && speed <= 100 ? speed : 1,
    loop: raw?.loop !== false,
  };
}

export interface ReplayIo {
  emit(data: Uint8Array): void;
  schedule(ms: number, fn: () => void): void;
  now(): number;
}

interface Reply {
  /** Milliseconds after the request (or after opening, for the greeting). */
  delay: number;
  data: Uint8Array;
}

export interface ReplayStep {
  request: Uint8Array;
  replies: Reply[];
}

export interface ReplayScript {
  /** What the device sent before the first request (boot message …). */
  greeting: Reply[];
  steps: ReplayStep[];
}

/** Splits a capture into requests of the application and the answers that followed. */
export function replayScript(events: readonly CaptureEvent[]): ReplayScript {
  const greeting: Reply[] = [];
  const steps: ReplayStep[] = [];
  let start: number | null = null;
  let lastTx = 0;
  let previous: 'rx' | 'tx' | null = null;
  // In time order (stable): a capture is written in order, but be tolerant.
  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i);
  for (const { e } of ordered) {
    if (e.d === 'open' && start === null) start = e.t;
    if (e.d !== 'rx' && e.d !== 'tx') continue;
    start ??= e.t;
    if (e.d === 'tx') {
      const current = steps[steps.length - 1];
      if (previous === 'tx' && current) current.request = concatBytes(current.request, e.data);
      else steps.push({ request: e.data, replies: [] });
      lastTx = e.t;
    } else {
      const current = steps[steps.length - 1];
      if (current) current.replies.push({ delay: Math.max(0, e.t - lastTx), data: e.data });
      else greeting.push({ delay: Math.max(0, e.t - start), data: e.data });
    }
    previous = e.d;
  }
  return { greeting, steps };
}

const startsWith = (data: Uint8Array, prefix: Uint8Array): boolean =>
  prefix.length <= data.length && prefix.every((b, i) => data[i] === b);

/** An incomplete request is dropped after this pause, like a device's frame timeout. */
const REQUEST_TIMEOUT_MS = 1000;

export interface ReplayStats {
  /** Requests that were answered. */
  answered: number;
  /** Requests that matched nothing in the capture. */
  unmatched: number;
  /** Requests found elsewhere in the capture (different order). */
  resyncs: number;
  /** Bytes the replay sent. */
  sent: number;
}

export class ReplayPlayer {
  readonly stats: ReplayStats = { answered: 0, unmatched: 0, resyncs: 0, sent: 0 };
  private readonly script: ReplayScript;
  private readonly rx: { t: number; data: Uint8Array }[];
  private index = 0;
  private pending: Uint8Array = new Uint8Array(0);
  private generation = 0;
  private writes = 0;

  constructor(
    events: readonly CaptureEvent[],
    private readonly options: ReplayOptions,
    private readonly io: ReplayIo,
  ) {
    this.script = replayScript(events);
    this.rx = events.flatMap((e) => (e.d === 'rx' ? [{ t: e.t, data: e.data }] : []));
  }

  /** The port was opened. */
  start(): void {
    this.generation++;
    this.index = 0;
    this.pending = new Uint8Array(0);
    if (this.options.mode === 'timed') this.playTimed();
    else this.playReplies(this.script.greeting);
  }

  stop(): void {
    this.generation++;
  }

  /** The application wrote to the device. */
  write(data: Uint8Array): void {
    if (this.options.mode === 'timed' || !data.length) return;
    this.pending = concatBytes(this.pending, data);
    const gen = this.generation;
    const write = ++this.writes;
    this.io.schedule(REQUEST_TIMEOUT_MS, () => {
      if (gen !== this.generation || write !== this.writes || !this.pending.length) return;
      this.stats.unmatched++;
      this.pending = new Uint8Array(0);
    });
    this.match();
  }

  private emit(data: Uint8Array): void {
    this.stats.sent += data.length;
    this.io.emit(data.slice());
  }

  private playReplies(replies: readonly Reply[]): void {
    const gen = this.generation;
    for (const reply of replies) {
      this.io.schedule(reply.delay / this.options.speed, () => {
        if (gen === this.generation) this.emit(reply.data);
      });
    }
  }

  private match(): void {
    const steps = this.script.steps;
    while (this.pending.length) {
      if (!steps.length) {
        this.stats.unmatched++;
        this.pending = new Uint8Array(0);
        return;
      }
      if (this.index >= steps.length) this.index = 0;
      const step = steps[this.index]!;
      if (startsWith(step.request, this.pending)) {
        // Complete – or the beginning of the expected request: wait for the rest.
        if (this.pending.length === step.request.length) this.answer(step);
        return;
      }
      if (startsWith(this.pending, step.request)) {
        this.pending = this.pending.subarray(step.request.length);
        this.answer(step, false);
        continue;
      }
      const found = this.find();
      if (found < 0) {
        this.stats.unmatched++;
        this.pending = new Uint8Array(0);
        return;
      }
      this.index = found;
      this.stats.resyncs++;
    }
  }

  private answer(step: ReplayStep, clear = true): void {
    this.stats.answered++;
    if (clear) this.pending = new Uint8Array(0);
    // After the last request the capture starts again: a device keeps answering.
    this.index = (this.index + 1) % this.script.steps.length;
    this.playReplies(step.replies);
  }

  /** The next step (in a circle, from the current one) the pending bytes fit. */
  private find(): number {
    const steps = this.script.steps;
    for (let k = 1; k <= steps.length; k++) {
      const j = (this.index + k) % steps.length;
      const request = steps[j]!.request;
      if (startsWith(request, this.pending) || startsWith(this.pending, request)) return j;
    }
    return -1;
  }

  /** Everything the device sent, on its original timeline (scaled by the speed). */
  private playTimed(): void {
    const gen = this.generation;
    if (!this.rx.length) return;
    const t0 = this.rx[0]!.t;
    const startedAt = this.io.now();
    let i = 0;
    const tick = (): void => {
      if (gen !== this.generation) return;
      const at = t0 + (this.io.now() - startedAt) * this.options.speed;
      // A small tolerance: rounding must not re-schedule the same event forever.
      while (i < this.rx.length && this.rx[i]!.t <= at + 0.01) this.emit(this.rx[i++]!.data);
      if (i < this.rx.length) {
        this.io.schedule(Math.max(0, (this.rx[i]!.t - at) / this.options.speed), tick);
      } else if (this.options.loop) {
        this.io.schedule(500, () => {
          if (gen === this.generation) this.playTimed();
        });
      }
    };
    tick();
  }
}
