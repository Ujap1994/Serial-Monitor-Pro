import { describe, expect, it } from 'vitest';
import {
  anonymizeCapture,
  bytesToHex,
  captureSummary,
  encodeCapture,
  encodeCaptureEvent,
  encodeCaptureHeader,
  hexToBytes,
  parseCapture,
  type CaptureEvent,
} from '@shared/core/capture';
import { encodeUtf8 } from '@shared/core/bytes';
import {
  normalizeReplayOptions,
  ReplayPlayer,
  replayScript,
  type ReplayOptions,
} from '@shared/core/replay';

const port = { baudRate: 115200, dataBits: 8, parity: 'None', stopBits: '1' } as const;
const text = (s: string) => encodeUtf8(s);

const session: CaptureEvent[] = [
  { t: 0, d: 'open', port: { ...port, path: '/dev/tty.usbmodem14101' } },
  { t: 5, d: 'rx', data: text('READY\n') },
  { t: 100, d: 'tx', data: text('ID?') },
  { t: 100.3, d: 'tx', data: text('\n') },
  { t: 112.5, d: 'rx', data: text('ID dev\n') },
  { t: 200, d: 'tx', data: text('PING 1\n') },
  { t: 209, d: 'rx', data: text('PO') },
  { t: 210, d: 'rx', data: text('NG 1\n') },
  { t: 300, d: 'lines', dtr: false, rts: true },
  { t: 400, d: 'break', ms: 250 },
  { t: 900, d: 'close', lost: true },
];

describe('session capture format', () => {
  it('writes and reads every kind of event unchanged', () => {
    const file =
      encodeCaptureHeader({ created: '2026-11-01T12:00:00.000Z', app: '1.4.0', port }) +
      session.map(encodeCaptureEvent).join('');
    const { header, events } = parseCapture(file);
    expect(header).toMatchObject({ format: 'smp-capture', version: 1, app: '1.4.0', port });
    expect(events).toEqual(session);
    expect(file.split('\n')[3]).toBe('{"t":100,"d":"tx","x":"49443f"}');
  });

  it('keeps bytes exact, including zero and 0xFF', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(hexToBytes(bytesToHex(all))).toEqual(all);
    expect(() => hexToBytes('0g')).toThrow();
    expect(() => hexToBytes('abc')).toThrow();
  });

  it('ignores a last line that was cut off, but reports damage elsewhere with its line', () => {
    const file = encodeCaptureHeader({ created: '', app: '' }) + encodeCaptureEvent(session[1]!);
    expect(parseCapture(`${file}{"t":12,"d":"r`).events).toHaveLength(1);
    expect(() => parseCapture(`${file}{"t":12,"d":"r\n${encodeCaptureEvent(session[1]!)}`)).toThrow(
      /Line 3: not valid JSON/,
    );
    expect(() => parseCapture(`${file}{"t":1,"d":"rx","x":"zz"}\n`)).toThrow(/Line 3: .*not hex/);
    expect(() => parseCapture(`${file}{"t":1,"d":"jump"}\n`)).toThrow(/unknown event "jump"/);
  });

  it('refuses other files and newer versions', () => {
    expect(() => parseCapture('hello')).toThrow(/not a Serial Monitor Pro capture/);
    expect(() => parseCapture('{"format":"other"}')).toThrow(/not a Serial Monitor Pro capture/);
    expect(() => parseCapture('{"format":"smp-capture","version":9}')).toThrow(/version 9/);
  });

  it('summarises and anonymises a capture', () => {
    expect(captureSummary(session)).toEqual({
      durationMs: 900,
      rxBytes: 6 + 7 + 7,
      txBytes: 4 + 7,
      rxEvents: 4,
      txEvents: 3,
      opens: 1,
      closes: 1,
    });
    const capture = {
      header: parseCapture(
        encodeCaptureHeader({ created: '', app: '', port: { ...port, path: '/dev/x' } }),
      ).header,
      events: session,
    };
    const anonymous = encodeCapture(anonymizeCapture(capture));
    expect(anonymous).not.toContain('/dev/');
    expect(parseCapture(anonymous).events).toHaveLength(session.length);
  });
});

/** A clock and scheduler under test control. */
function harness(options: Partial<ReplayOptions>) {
  let now = 0;
  const queue: { at: number; fn: () => void }[] = [];
  const out: { t: number; text: string }[] = [];
  const player = new ReplayPlayer(session, normalizeReplayOptions(options), {
    emit: (data) => out.push({ t: now, text: new TextDecoder().decode(data) }),
    schedule: (ms, fn) => queue.push({ at: now + ms, fn }),
    now: () => now,
  });
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > until) break;
      queue.shift();
      now = next.at;
      next.fn();
    }
    now = until;
  };
  return { player, out, advance, text: () => out.map((o) => o.text).join('') };
}

describe('replaying a capture as a device', () => {
  it('splits the capture into greeting, requests and answers', () => {
    const script = replayScript(session);
    expect(script.greeting).toEqual([{ delay: 5, data: text('READY\n') }]);
    expect(script.steps.map((s) => new TextDecoder().decode(s.request))).toEqual([
      'ID?\n',
      'PING 1\n',
    ]);
    expect(script.steps[0]!.replies[0]!.delay).toBeCloseTo(12.2);
  });

  it('answers recorded requests with the recorded bytes and delays', () => {
    const h = harness({ mode: 'answer' });
    h.player.start();
    h.advance(10);
    expect(h.text()).toBe('READY\n');
    h.player.write(text('ID'));
    h.player.write(text('?\n')); // split differently than recorded
    h.advance(12);
    expect(h.text()).toBe('READY\n');
    h.advance(1);
    expect(h.text()).toBe('READY\nID dev\n');
    h.player.write(text('PING 1\n'));
    h.advance(20);
    expect(h.text()).toBe('READY\nID dev\nPONG 1\n');
    expect(h.player.stats).toMatchObject({ answered: 2, unmatched: 0, resyncs: 0 });
  });

  it('finds a request asked out of order again and ignores unknown ones', () => {
    const h = harness({ mode: 'answer', speed: 10 });
    h.player.start();
    h.player.write(text('PING 1\n'));
    h.advance(5);
    expect(h.text()).toBe('READY\nPONG 1\n');
    h.player.write(text('PING 1\n')); // polled again: answered again
    h.advance(5);
    expect(h.text()).toBe('READY\nPONG 1\nPONG 1\n');
    h.player.write(text('HELLO\n'));
    h.advance(5);
    expect(h.player.stats).toMatchObject({ answered: 2, unmatched: 1, resyncs: 2 });
    // An incomplete request is dropped after a pause.
    h.player.write(text('ID'));
    h.advance(1500);
    expect(h.player.stats.unmatched).toBe(2);
  });

  it('plays everything on the original timeline in "timed" mode, scaled by the speed', () => {
    const h = harness({ mode: 'timed', speed: 2, loop: false });
    h.player.start();
    h.player.write(text('ignored'));
    h.advance(1000);
    const times = h.out.map((o) => o.t);
    expect(times).toHaveLength(4);
    [0, 53.75, 102, 102.5].forEach((t, i) => expect(times[i]).toBeCloseTo(t, 1));
    expect(h.text()).toBe('READY\nID dev\nPONG 1\n');
  });

  it('repeats in "timed" mode with loop, and stops when closed', () => {
    const h = harness({ mode: 'timed', speed: 100, loop: true });
    h.player.start();
    h.advance(1200);
    expect(h.text()).toContain('READY\nID dev\nPONG 1\nREADY\n');
    h.player.stop();
    const before = h.out.length;
    h.advance(5000);
    expect(h.out.length).toBe(before);
  });
});
