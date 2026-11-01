import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Eraser, LineChart, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { decodeUtf8 } from '@shared/core/bytes';
import type { GraphConfig } from '@shared/core/settings';
import { fileStamp } from '@shared/core/timestamp';
import {
  channelPatternError,
  extractChannels,
  extractValues,
  seriesCsv,
  seriesStats,
  type ExtractMode,
  type GraphChannel,
  type SeriesStats,
} from '@shared/core/values';
import {
  Button,
  Card,
  Check,
  Field,
  Input,
  NumberInput,
  PageHeader,
  Select,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { useStore } from '../lib/store';
import { appStore, setBusy, setStatus, updateSettings } from '../state/app';
import { alertDialog, toast } from '../state/ui';
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

/**
 * Colour of a curve: the channel colour in "own patterns" mode, otherwise a
 * colour chosen in the legend, otherwise the palette by order of appearance.
 */
export function curveColor(config: GraphConfig, name: string, index: number): string {
  if (config.mode === 'regex') {
    const channel = config.channels.find((c) => c.name.trim() === name);
    if (channel) return channel.color;
  }
  return config.colors[name] ?? SERIES_COLORS[index % SERIES_COLORS.length] ?? '#3b82f6';
}

/** Python example channels for the "own patterns" mode. */
const EXAMPLE_CHANNELS: GraphChannel[] = [
  { name: 'Temp', pattern: 'Temp:\\s*(-?\\d+(?:[.,]\\d+)?)', color: '#ef4444', enabled: true },
  {
    name: 'Humidity',
    pattern: 'Humidity:\\s*(-?\\d+(?:[.,]\\d+)?)',
    color: '#3b82f6',
    enabled: true,
  },
];

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
  colorOf: (name: string, index: number) => string,
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
    const color = colorOf(name, names.indexOf(name));
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
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<[string, SeriesStats][]>([]);
  const showStatsRef = useLatest(showStats);
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
        const values =
          c.mode === 'regex'
            ? extractChannels(line.trim(), c.channels)
            : extractValues(line.trim(), c.mode, c.separator);
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
      draw(canvas.current, series.current, hiddenRef.current, t('graph.empty'), (name, i) =>
        curveColor(configRef.current, name, i),
      );
      setLatest([...series.current.entries()].map(([n, v]) => [n, v[v.length - 1] ?? 0]));
      if (showStatsRef.current) {
        setStats(
          [...series.current.entries()].flatMap(([n, v]) => {
            const st = seriesStats(v);
            return st ? [[n, st] as [string, SeriesStats]] : [];
          }),
        );
      }
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
  }, [tab, t, hiddenRef, showStatsRef, configRef]);

  useEffect(() => {
    dirty.current = true;
  }, [dark, hidden, config.points, showStats]);

  const exportCsv = async (): Promise<void> => {
    if (!series.current.size) {
      await alertDialog(t('export.emptyTitle'), t('graph.exportEmpty'));
      return;
    }
    const path = await window.smp.files.saveText(
      `graph_${fileStamp()}.csv`,
      seriesCsv(series.current, t('graph.index')),
      [{ name: 'CSV', extensions: ['csv'] }],
    );
    if (path) {
      setStatus(t('export.saved', { path }), 'ok');
      toast(t('export.saved', { path }), 'ok');
    }
  };

  /** Colour from the legend: the channel colour in "own patterns" mode, otherwise per curve. */
  const setColor = (name: string, color: string): void => {
    const channel = config.mode === 'regex' && config.channels.find((c) => c.name.trim() === name);
    if (channel)
      set({ channels: config.channels.map((c) => (c === channel ? { ...c, color } : c)) });
    else set({ colors: { ...config.colors, [name]: color } });
    dirty.current = true;
  };

  const setChannel = (index: number, patch: Partial<GraphChannel>): void => {
    set({ channels: config.channels.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
    dirty.current = true;
  };

  // At most three decimals, without trailing zeros (21.63, 39, 1011.2).
  const fmt = (v: number): string => String(Number(v.toFixed(3)));

  return (
    <>
      <PageHeader title={t('graph.title')} description={t('graph.description')} />
      <Card title={t('graph.controls')} icon={LineChart}>
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
                { value: 'regex', label: t('graph.mode.regex') },
                { value: 'separated', label: t('graph.mode.separated') },
              ]}
              onChange={(mode) =>
                set(
                  mode === 'regex' && !config.channels.length
                    ? { mode, channels: EXAMPLE_CHANNELS }
                    : { mode },
                )
              }
              data-testid="graph-mode"
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
          <Check checked={showStats} onChange={setShowStats} testId="graph-stats-toggle">
            {t('graph.stats')}
          </Check>
          <Button icon={Download} onClick={() => void exportCsv()} data-testid="graph-export">
            {t('graph.export')}
          </Button>
          <Button
            icon={Eraser}
            onClick={() => {
              series.current.clear();
              setLatest([]);
              setStats([]);
              setHidden(new Set());
              dirty.current = true;
            }}
          >
            {t('graph.clear')}
          </Button>
        </div>
        {config.mode === 'regex' && (
          <div className="channels" data-testid="graph-channels">
            {config.channels.map((ch, i) => {
              const error = channelPatternError(ch.pattern);
              return (
                <div className="channel-row" key={i}>
                  <Check
                    checked={ch.enabled}
                    onChange={(enabled) => setChannel(i, { enabled })}
                    title={t('graph.channelEnabled')}
                  >
                    {''}
                  </Check>
                  <input
                    type="color"
                    className="color-swatch"
                    value={ch.color}
                    aria-label={t('graph.color')}
                    onChange={(e) => setChannel(i, { color: e.target.value })}
                  />
                  <Input
                    value={ch.name}
                    placeholder={t('graph.channelName')}
                    onChange={(e) => setChannel(i, { name: e.target.value })}
                    data-testid={`graph-channel-name-${i}`}
                  />
                  <Input
                    mono
                    value={ch.pattern}
                    placeholder="Temp:\s*([-\d.]+)"
                    aria-invalid={Boolean(error && error !== 'empty')}
                    title={error && error !== 'empty' ? error : t('graph.patternTip')}
                    onChange={(e) => setChannel(i, { pattern: e.target.value })}
                    data-testid={`graph-channel-pattern-${i}`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={Trash2}
                    title={t('common.delete')}
                    onClick={() => set({ channels: config.channels.filter((_, j) => j !== i) })}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              );
            })}
            <div className="row">
              <Button
                size="sm"
                icon={Plus}
                disabled={config.channels.length >= 16}
                onClick={() =>
                  set({
                    channels: [
                      ...config.channels,
                      {
                        name: t('graph.valueN', { n: config.channels.length + 1 }),
                        pattern: '',
                        color:
                          SERIES_COLORS[config.channels.length % SERIES_COLORS.length] ?? '#3b82f6',
                        enabled: true,
                      },
                    ],
                  })
                }
                data-testid="graph-channel-add"
              >
                {t('graph.channelAdd')}
              </Button>
              <span className="muted small">{t('graph.patternHint')}</span>
            </div>
          </div>
        )}
      </Card>
      <div className="legend" data-testid="graph-legend">
        {latest.length === 0 ? (
          <span className="muted">{t('graph.hint')}</span>
        ) : (
          latest.map(([name, value], i) => (
            <span key={name} className="legend-item" data-off={hidden.has(name)}>
              <input
                type="color"
                className="color-swatch"
                value={curveColor(config, name, i)}
                title={t('graph.colorTip')}
                aria-label={`${t('graph.color')} ${name}`}
                onChange={(e) => setColor(name, e.target.value)}
                data-testid={`graph-color-${name}`}
              />
              <button
                type="button"
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
                {name}
                <b>{Number.isInteger(value) ? value : value.toFixed(2)}</b>
              </button>
            </span>
          ))
        )}
      </div>
      {showStats && stats.length > 0 && (
        <div className="table-wrap graph-stats">
          <table className="table" data-testid="graph-stats">
            <thead>
              <tr>
                <th>{t('graph.curve')}</th>
                <th>{t('graph.stat.count')}</th>
                <th>Min</th>
                <th>Max</th>
                <th>Ø</th>
                <th>{t('graph.stat.stddev')}</th>
                <th>Median</th>
                <th>{t('graph.stat.range')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(([name, st]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="mono">{st.count}</td>
                  <td className="mono">{fmt(st.min)}</td>
                  <td className="mono">{fmt(st.max)}</td>
                  <td className="mono">{fmt(st.mean)}</td>
                  <td className="mono">{fmt(st.stddev)}</td>
                  <td className="mono">{fmt(st.median)}</td>
                  <td className="mono">{fmt(st.range)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="plot">
        <canvas ref={canvas} data-testid="graph-canvas" />
      </div>
    </>
  );
}
