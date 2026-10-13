import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Eraser, Pause, Play } from 'lucide-react';
import { decodeUtf8 } from '@shared/core/bytes';
import type { GraphConfig } from '@shared/core/settings';
import { extractValues, type ExtractMode } from '@shared/core/values';
import { Button, Card, Field, NumberInput, PageHeader, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { useStore } from '../lib/store';
import { appStore, setBusy, updateSettings } from '../state/app';
import { rxBus } from '../state/serial';

export const SERIES_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
] as const;

type Series = Map<string, number[]>;

function niceStep(span: number): number {
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * pow;
}

function formatTick(v: number, step: number): string {
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
  return v.toFixed(decimals);
}

function draw(
  canvas: HTMLCanvasElement,
  series: Series,
  hidden: Set<string>,
  emptyText: string,
): void {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const css = getComputedStyle(canvas);
  const grid = css.getPropertyValue('--monitor-line').trim() || '#cbd5e1';
  const muted = css.getPropertyValue('--muted').trim() || '#64748b';
  const mono = css.getPropertyValue('--font-mono').trim() || 'monospace';

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const visible = [...series.entries()].filter(([name, v]) => !hidden.has(name) && v.length);
  const values = visible.flatMap(([, v]) => v);
  const left = 64;
  const right = 16;
  const top = 14;
  const bottom = 26;
  const pw = Math.max(1, w - left - right);
  const ph = Math.max(1, h - top - bottom);

  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const span = hi - lo || 1;

  ctx.font = `11px ${mono}`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (let v = lo; v <= hi + step / 2; v += step) {
    const y = Math.round(top + ph * (1 - (v - lo) / span)) + 0.5;
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.fillText(formatTick(v, step), left - 8, y);
  }

  if (!values.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;
    ctx.font = `13px ${css.getPropertyValue('--font-ui')}`;
    emptyText
      .split('\n')
      .forEach((line, i, all) =>
        ctx.fillText(line, left + pw / 2, top + ph / 2 + (i - (all.length - 1) / 2) * 18),
      );
    return;
  }

  const longest = Math.max(...visible.map(([, v]) => v.length));
  ctx.textAlign = 'center';
  ctx.fillStyle = muted;
  ctx.fillText('0', left, h - bottom / 2);
  ctx.fillText(String(longest - 1), w - right - 12, h - bottom / 2);

  const names = [...series.keys()];
  for (const [name, v] of visible) {
    const color = SERIES_COLORS[names.indexOf(name) % SERIES_COLORS.length] ?? '#3b82f6';
    const dx = pw / Math.max(1, longest - 1);
    const offset = longest - v.length;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    v.forEach((val, i) => {
      const x = left + (i + offset) * dx;
      const y = top + ph * (1 - (val - lo) / span);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const last = v[v.length - 1] ?? 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(left + (longest - 1) * dx, top + ph * (1 - (last - lo) / span), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function GraphPage(): ReactNode {
  const t = useT();
  const config = useStore(appStore, (s) => s.settings.graph);
  const dark = useStore(appStore, (s) => s.dark);
  const tab = useStore(appStore, (s) => s.tab);
  const [recording, setRecording] = useState(false);
  const [latest, setLatest] = useState<[string, number][]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canvas = useRef<HTMLCanvasElement>(null);
  const series = useRef<Series>(new Map());
  const dirty = useRef(true);
  const configRef = useLatest(config);
  const hiddenRef = useLatest(hidden);

  const set = (patch: Partial<GraphConfig>): void =>
    updateSettings({ graph: { ...config, ...patch } });

  useEffect(() => {
    setBusy('graph', recording);
    if (!recording) return;
    let pending = '';
    return rxBus.on((chunk) => {
      pending += decodeUtf8(chunk.data);
      const lines = pending.split('\n');
      pending = (lines.pop() ?? '').slice(-4096);
      const c = configRef.current;
      let changed = false;
      for (const line of lines) {
        const values = extractValues(line.trim(), c.mode, c.separator);
        for (const [name, value] of Object.entries(values)) {
          let list = series.current.get(name);
          if (!list) {
            list = [];
            series.current.set(name, list);
          }
          list.push(value);
          if (list.length > c.points) list.splice(0, list.length - c.points);
          changed = true;
        }
      }
      if (changed) dirty.current = true;
    });
  }, [recording, configRef]);

  // Redraw at most ~30 times per second, and only while the tab is visible.
  useEffect(() => {
    if (tab !== 'graph') return;
    dirty.current = true;
    let frame = 0;
    let last = 0;
    const loop = (time: number): void => {
      frame = requestAnimationFrame(loop);
      if (!dirty.current || time - last < 33 || !canvas.current) return;
      last = time;
      dirty.current = false;
      draw(canvas.current, series.current, hiddenRef.current, t('graph.empty'));
      setLatest([...series.current.entries()].map(([n, v]) => [n, v[v.length - 1] ?? 0]));
    };
    frame = requestAnimationFrame(loop);
    const resize = new ResizeObserver(() => {
      dirty.current = true;
    });
    if (canvas.current) resize.observe(canvas.current);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [tab, t, hiddenRef]);

  useEffect(() => {
    dirty.current = true;
  }, [dark, hidden, config.points]);

  return (
    <>
      <PageHeader title={t('graph.title')} description={t('graph.description')} />
      <Card>
        <div className="row">
          <Button
            variant={recording ? 'danger' : 'success'}
            icon={recording ? Pause : Play}
            wide
            onClick={() => setRecording(!recording)}
            data-testid="graph-record"
          >
            {recording ? t('graph.pause') : t('graph.record')}
          </Button>
          <Field label={t('graph.detection')}>
            <Select<ExtractMode>
              value={config.mode}
              options={[
                { value: 'auto', label: t('graph.mode.auto') },
                { value: 'labeled', label: t('graph.mode.labeled') },
                { value: 'separated', label: t('graph.mode.separated') },
              ]}
              onChange={(mode) => set({ mode })}
            />
          </Field>
          <Field label={t('graph.separator')}>
            <Select<GraphConfig['separator']>
              value={config.separator}
              title={t('graph.separatorTip')}
              options={[
                { value: ',', label: t('graph.sep.comma') },
                { value: ';', label: t('graph.sep.semicolon') },
                { value: ' ', label: t('graph.sep.space') },
                { value: '\t', label: t('graph.sep.tab') },
              ]}
              onChange={(separator) => set({ separator })}
            />
          </Field>
          <Field label={t('graph.points')}>
            <NumberInput
              value={config.points}
              min={50}
              max={5000}
              onChange={(points) => set({ points })}
              style={{ width: 96 }}
            />
          </Field>
          <span className="spacer" />
          <Button
            icon={Eraser}
            onClick={() => {
              series.current.clear();
              setLatest([]);
              setHidden(new Set());
              dirty.current = true;
            }}
          >
            {t('graph.clear')}
          </Button>
        </div>
      </Card>
      <div className="legend" data-testid="graph-legend">
        {latest.length === 0 ? (
          <span className="muted">{t('graph.hint')}</span>
        ) : (
          latest.map(([name, value], i) => (
            <button
              type="button"
              key={name}
              className="legend-item"
              data-off={hidden.has(name)}
              title={t('graph.toggleSeries')}
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                })
              }
            >
              <i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {name}
              <b>{Number.isInteger(value) ? value : value.toFixed(2)}</b>
            </button>
          ))
        )}
      </div>
      <div className="plot">
        <canvas ref={canvas} data-testid="graph-canvas" />
      </div>
    </>
  );
}
