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
import { matchesFilter } from '@shared/core/format';
import { renderEntry, type Entry, type MonitorModel, type RenderOptions } from '../lib/monitor';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { Button } from './ui';

const BLOCK = 200;

/** Shared scrolling behaviour: follow new lines unless the user scrolled up. */
function useFollow(ref: RefObject<HTMLDivElement | null>) {
  const following = useRef(true);
  const [behind, setBehind] = useState(false);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (following.current) setBehind(false);
  }, [ref]);

  const afterAppend = useCallback(
    (autoscroll: boolean) => {
      const el = ref.current;
      if (!el) return;
      if (autoscroll && following.current) el.scrollTop = el.scrollHeight;
      else if (autoscroll) setBehind(true);
    },
    [ref],
  );

  const jump = useCallback(() => {
    const el = ref.current;
    if (!el) return;
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
    highlight(text, line.text, filtered ? this.filter : '');
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
        content.append(row);
        while (content.childElementCount > maxLines) content.firstElementChild?.remove();
        setIsEmpty(false);
        afterAppend(true);
      },
      clear() {
        contentRef.current?.replaceChildren();
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
