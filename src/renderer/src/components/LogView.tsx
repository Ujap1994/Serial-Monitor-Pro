// Fast, imperative views for streaming text.
//
// React re-rendering thousands of lines per second would be far too slow, so
// these components manage their DOM directly. Lines are grouped in blocks with
// `content-visibility: auto`, which lets the browser skip off-screen blocks.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowDown, type LucideIcon } from 'lucide-react';
import type { AnsiSegment } from '@shared/core/ansi';
import { matchesFilter } from '@shared/core/format';
import { renderEntry, type Entry, type MonitorModel, type RenderOptions } from '../lib/monitor';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { Button } from './ui';

const BLOCK = 200;

/**
 * Shared scrolling behaviour: follow new lines unless the user scrolled up.
 * Scrolling reads the height of the whole output, which makes the browser lay it
 * out – so it happens at most once per frame, never once per line.
 */
function useFollow(ref: RefObject<HTMLDivElement | null>) {
  const following = useRef(true);
  const frame = useRef(0);
  const [behind, setBehind] = useState(false);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (following.current) setBehind(false);
  }, [ref]);

  const afterAppend = useCallback(
    (autoscroll: boolean) => {
      if (!autoscroll || !ref.current) return;
      if (!following.current) {
        setBehind(true);
        return;
      }
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const el = ref.current;
        if (el && following.current) el.scrollTop = el.scrollHeight;
      });
    },
    [ref],
  );

  const jump = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    following.current = true;
    el.scrollTop = el.scrollHeight;
    setBehind(false);
  }, [ref]);

  return { onScroll, afterAppend, jump, behind };
}

function highlight(target: HTMLElement, text: string, pattern: string): void {
  if (!pattern) {
    target.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  const needle = pattern.toLowerCase();
  let pos = 0;
  let idx = lower.indexOf(needle);
  while (idx >= 0) {
    if (idx > pos) target.append(text.slice(pos, idx));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + needle.length);
    target.append(mark);
    pos = idx + needle.length;
    idx = lower.indexOf(needle, pos);
  }
  if (pos < text.length) target.append(text.slice(pos));
}

/** Coloured text: palette colours as classes (they follow the theme), others inline. */
function appendAnsi(target: HTMLElement, segments: readonly AnsiSegment[]): void {
  for (const { text, style } of segments) {
    if (!style) {
      target.append(text);
      continue;
    }
    const el = document.createElement('span');
    const fg = style.inverse ? style.bg : style.fg;
    const bg = style.inverse ? style.fg : style.bg;
    const classes = ['ansi'];
    if (typeof fg === 'number') classes.push(`ansi-fg${fg}`);
    if (typeof bg === 'number') classes.push(`ansi-bg${bg}`);
    if (style.inverse && fg === undefined) classes.push('ansi-inverse');
    if (style.bold) classes.push('ansi-bold');
    if (style.dim) classes.push('ansi-dim');
    if (style.italic) classes.push('ansi-italic');
    if (style.underline) classes.push('ansi-underline');
    el.className = classes.join(' ');
    if (typeof fg === 'string') el.style.color = fg;
    if (typeof bg === 'string') el.style.backgroundColor = bg;
    el.textContent = text;
    target.append(el);
  }
}

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

/** Writes monitor entries into a container, grouped in blocks. */
class RowWriter {
  private rows: { id: number; el: HTMLElement }[] = [];
  private blockFill = 0;
  options: RenderOptions | null = null;
  filter = '';

  constructor(private readonly content: HTMLElement) {}

  get count(): number {
    return this.rows.length;
  }

  private row(e: Entry): HTMLElement | null {
    if (!this.options) return null;
    const line = renderEntry(e, this.options);
    const filtered = this.filter && (e.kind === 'rx' || e.kind === 'tx');
    if (filtered && !matchesFilter(line.text, this.filter)) return null;
    const row = document.createElement('div');
    row.className = `ln ln-${e.kind}`;
    if (line.ts) row.append(span('ln-ts', line.ts));
    if (line.dt) row.append(span('ln-dt', line.dt));
    row.append(span('ln-dir', line.dir));
    const text = document.createElement('span');
    text.className = 'ln-text';
    // Colours of the device; while filtering, the matches are marked instead.
    if (line.segments && !filtered) appendAnsi(text, line.segments);
    else highlight(text, line.text, filtered ? this.filter : '');
    row.append(text);
    return row;
  }

  append(entries: readonly Entry[]): void {
    let block = this.content.lastElementChild as HTMLElement | null;
    for (const e of entries) {
      const el = this.row(e);
      if (!el) continue;
      if (!block || this.blockFill >= BLOCK) {
        block = document.createElement('div');
        block.className = 'log-block';
        this.content.append(block);
        this.blockFill = 0;
      }
      block.append(el);
      this.blockFill++;
      this.rows.push({ id: e.id, el });
    }
  }

  replace(entries: readonly Entry[]): void {
    this.content.replaceChildren();
    this.rows = [];
    this.blockFill = 0;
    this.append(entries);
  }

  /** Removes rows of entries that the model has dropped. */
  trim(firstId: number): void {
    let n = 0;
    while (n < this.rows.length && (this.rows[n]?.id ?? Infinity) < firstId) {
      const el = this.rows[n]?.el;
      const block = el?.parentElement;
      el?.remove();
      if (block && !block.childElementCount) block.remove();
      n++;
    }
    this.rows.splice(0, n);
    if (!this.content.lastElementChild) this.blockFill = 0;
  }
}

interface MonitorViewProps {
  model: MonitorModel;
  options: RenderOptions;
  filter: string;
  autoscroll: boolean;
  empty: ReactNode;
  emptyIcon: LucideIcon;
  onStats?: (shown: number, total: number) => void;
}

/** The main monitor output. */
export function MonitorView({
  model,
  options,
  filter,
  autoscroll,
  empty,
  emptyIcon: EmptyIcon,
  onStats,
}: MonitorViewProps): ReactNode {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const writer = useRef<RowWriter | null>(null);
  const [isEmpty, setIsEmpty] = useState(model.size === 0);
  const { onScroll, afterAppend, jump, behind } = useFollow(scrollRef);
  const latest = useLatest({ autoscroll, onStats });

  // Subscribe to the model once.
  useEffect(() => {
    if (!contentRef.current) return;
    const w = new RowWriter(contentRef.current);
    writer.current = w;
    const stats = (): void => latest.current.onStats?.(w.count, model.size);
    const offAppend = model.appended.on((entries) => {
      w.append(entries);
      setIsEmpty(false);
      stats();
      afterAppend(latest.current.autoscroll);
    });
    const offReset = model.reset.on(() => {
      w.replace([]);
      setIsEmpty(true);
      stats();
      jump();
    });
    const offTrim = model.trimmed.on((firstId) => {
      w.trim(firstId);
      stats();
    });
    return () => {
      offAppend();
      offReset();
      offTrim();
      writer.current = null;
    };
  }, [model, afterAppend, jump, latest]);

  // Re-render everything when the display options or the filter change.
  useEffect(() => {
    const w = writer.current;
    if (!w) return;
    w.options = options;
    w.filter = filter;
    w.replace(model.all());
    latest.current.onStats?.(w.count, model.size);
    jump();
  }, [model, options, filter, jump, latest]);

  return (
    <div className="log-wrap">
      <div className="log" ref={scrollRef} onScroll={onScroll} data-testid="monitor-output">
        <div ref={contentRef} />
        {isEmpty && (
          <div className="log-empty">
            <EmptyIcon size={34} strokeWidth={1.5} aria-hidden />
            <div>{empty}</div>
          </div>
        )}
      </div>
      {behind && (
        <Button className="log-jump" variant="primary" size="sm" icon={ArrowDown} onClick={jump}>
          {t('monitor.jumpToEnd')}
        </Button>
      )}
    </div>
  );
}

export interface TextLogHandle {
  append(text: string, kind?: Entry['kind'], color?: string): void;
  clear(): void;
}

interface TextLogProps {
  maxLines?: number;
  empty: ReactNode;
  emptyIcon: LucideIcon;
  testId?: string;
}

/** Append-only output for the analysis tools (frame parser, decoder …). */
export const TextLog = forwardRef<TextLogHandle, TextLogProps>(function TextLog(
  { maxLines = 5000, empty, emptyIcon: EmptyIcon, testId },
  ref,
) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rows = useRef(0);
  const [isEmpty, setIsEmpty] = useState(true);
  const { onScroll, afterAppend, jump, behind } = useFollow(scrollRef);

  useImperativeHandle(
    ref,
    () => ({
      append(text, kind = 'rx', color) {
        const content = contentRef.current;
        if (!content) return;
        const row = document.createElement('div');
        row.className = `ln ln-${kind}`;
        const el = span('ln-text', text);
        if (color) el.style.color = color;
        row.append(el);
        // Rows in blocks: the browser skips the layout of blocks out of view.
        let block = content.lastElementChild as HTMLElement | null;
        if (!block || block.childElementCount >= BLOCK) {
          block = document.createElement('div');
          block.className = 'log-block';
          content.append(block);
        }
        block.append(row);
        rows.current++;
        while (rows.current > maxLines) {
          const first = content.firstElementChild;
          if (!first) break;
          first.firstElementChild?.remove();
          if (!first.childElementCount) first.remove();
          rows.current--;
        }
        if (rows.current === 1) setIsEmpty(false);
        afterAppend(true);
      },
      clear() {
        contentRef.current?.replaceChildren();
        rows.current = 0;
        setIsEmpty(true);
        jump();
      },
    }),
    [maxLines, afterAppend, jump],
  );

  return (
    <div className="log-wrap">
      <div className="log" ref={scrollRef} onScroll={onScroll} data-testid={testId}>
        <div ref={contentRef} />
        {isEmpty && (
          <div className="log-empty">
            <EmptyIcon size={30} strokeWidth={1.5} aria-hidden />
            <div>{empty}</div>
          </div>
        )}
      </div>
      {behind && (
        <Button className="log-jump" variant="primary" size="sm" icon={ArrowDown} onClick={jump}>
          {t('monitor.jumpToEnd')}
        </Button>
      )}
    </div>
  );
});
