import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  Cable,
  Columns2,
  Eraser,
  Plug,
  RefreshCw,
  ScrollText,
  Unplug,
  Rows3,
} from 'lucide-react';
import { StreamAssembler } from '@shared/core/assembler';
import { formatBytes, formatText } from '@shared/core/format';
import { formatCount } from '@shared/i18n';
import { BAUD_RATES } from '@shared/core/settings';
import { formatTimestamp } from '@shared/core/timestamp';
import { TextLog, type TextLogHandle } from '../components/LogView';
import { Button, Card, Check, Input, PageHeader, Segmented, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { useStore } from '../lib/store';
import { appStore, setBusy } from '../state/app';
import { describeFailure, multiPortBus, refreshPorts } from '../state/serial';
import { alertDialog } from '../state/ui';

export const SLOT_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6'] as const;
const SLOTS = SLOT_COLORS.length;

type SlotState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface Slot {
  path: string;
  baud: number;
  state: SlotState;
  openPath: string;
}

export function MultiPortPage(): ReactNode {
  const t = useT();
  const ports = useStore(appStore, (s) => s.ports);
  const [slots, setSlots] = useState<Slot[]>(() =>
    Array.from({ length: SLOTS }, () => ({
      path: '',
      baud: 115200,
      state: 'disconnected',
      openPath: '',
    })),
  );
  const log = useRef<TextLogHandle>(null);
  // One output per slot for the separate view (Python: view mode). Both views
  // are filled all the time, so switching never loses lines.
  const slotLogs = useRef<(TextLogHandle | null)[]>([]);
  const [view, setView] = useState<'combined' | 'separate'>('combined');
  const slotsRef = useLatest(slots);
  const assemblers = useRef(
    Array.from({ length: SLOTS }, () => new StreamAssembler('newline', 100)),
  );
  const timers = useRef<(ReturnType<typeof setTimeout> | null)[]>(
    Array.from({ length: SLOTS }, () => null),
  );
  // Byte counters per slot; shown twice per second instead of re-rendering per packet.
  const counters = useRef(Array.from({ length: SLOTS }, () => ({ rx: 0, tx: 0 })));
  const [shownCounters, setShownCounters] = useState(() =>
    Array.from({ length: SLOTS }, () => ({ rx: 0, tx: 0 })),
  );
  const [bridge, setBridge] = useState({ on: false, from: 0, to: 1, both: false, bytes: 0 });
  const bridgeRef = useLatest(bridge);
  const bridged = useRef(0);

  const update = (i: number, patch: Partial<Slot>): void =>
    setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const write = (i: number, text: string): void => {
    const slot = slotsRef.current[i];
    const time = formatTimestamp(Date.now(), 'time-ms');
    log.current?.append(
      `[${time}] [${slot?.openPath || slot?.path || '?'}] ${text}`,
      'rx',
      SLOT_COLORS[i],
    );
    slotLogs.current[i]?.append(`[${time}] ${text}`, 'rx');
  };

  const clearAll = (): void => {
    log.current?.clear();
    for (const l of slotLogs.current) l?.clear();
  };

  const render = (data: Uint8Array): string => {
    const s = appStore.get().settings;
    return s.display === 'ASCII'
      ? formatText(data, s.utf8).replace(/(\r\n|\n|\r)$/, '')
      : formatBytes(data, s.display);
  };

  useEffect(() => {
    setBusy(
      'multiport',
      slots.some((s) => s.state === 'connected'),
    );
  }, [slots]);

  useEffect(() => {
    const timer = setInterval(() => {
      setShownCounters((prev) =>
        prev.every((p, i) => p.rx === counters.current[i]?.rx && p.tx === counters.current[i]?.tx)
          ? prev
          : counters.current.map((c) => ({ ...c })),
      );
      setBridge((b) => (b.bytes === bridged.current ? b : { ...b, bytes: bridged.current }));
    }, 500);
    return () => clearInterval(timer);
  }, []);

  /** Bridge mode of the Python version: forward everything slot A receives to slot B. */
  const forward = (from: number, data: Uint8Array): void => {
    const b = bridgeRef.current;
    if (!b.on || b.from === b.to) return;
    const target = from === b.from ? b.to : b.both && from === b.to ? b.from : -1;
    if (target < 0 || slotsRef.current[target]?.state !== 'connected') return;
    void window.smp.serial.write(`mp${target}`, data).then((result) => {
      if (!result.ok) return;
      const c = counters.current[target];
      if (c) c.tx += data.length;
      bridged.current += data.length;
    });
  };

  useEffect(() => {
    return multiPortBus.on((event) => {
      const i = Number(event.id.slice(2));
      if (!Number.isInteger(i) || i < 0 || i >= SLOTS) return;
      const assembler = assemblers.current[i] as StreamAssembler;
      if (event.kind === 'data') {
        for (const chunk of event.chunks) {
          const c = counters.current[i];
          if (c) c.rx += chunk.data.length;
          forward(i, chunk.data);
          for (const entry of assembler.push(chunk)) write(i, render(entry.data));
        }
        const prev = timers.current[i];
        if (prev) clearTimeout(prev);
        timers.current[i] = setTimeout(() => {
          const rest = assembler.flushAll();
          if (rest) write(i, render(rest.data));
        }, 120);
        return;
      }
      const rest = assembler.flushAll();
      if (rest) write(i, render(rest.data));
      write(
        i,
        event.lost ? t('multiport.lost', { error: event.error ?? '' }) : t('multiport.closed'),
      );
      update(i, { state: event.lost ? 'error' : 'disconnected', openPath: '' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close all side connections when the page unmounts (window closing).
  useEffect(
    () => () => {
      for (let i = 0; i < SLOTS; i++) void window.smp.serial.close(`mp${i}`);
    },
    [],
  );

  /** An empty slot shows the first available port – use the same one when connecting. */
  const pathOf = (slot: Slot): string => slot.path || ports[0]?.path || '';

  const toggle = async (i: number): Promise<void> => {
    const current = slots[i] as Slot;
    const slot = { ...current, path: pathOf(current) };
    if (slot.state === 'connected') {
      await window.smp.serial.close(`mp${i}`);
      return;
    }
    if (!slot.path) {
      await alertDialog(t('error.noPortTitle'), t('error.noPortSelected'), 'warn');
      return;
    }
    update(i, { state: 'connecting' });
    assemblers.current[i]?.reset();
    counters.current[i] = { rx: 0, tx: 0 };
    const result = await window.smp.serial.open(`mp${i}`, {
      path: slot.path,
      baudRate: slot.baud,
      dataBits: 8,
      parity: 'None',
      stopBits: '1',
    });
    if (!result.ok) {
      update(i, { state: 'error' });
      write(i, `${t('multiport.error')}: ${result.error}`);
      await alertDialog(t('error.connectTitle'), describeFailure(result, slot.path), 'error');
      return;
    }
    update(i, { state: 'connected', openPath: slot.path });
    slotsRef.current = slotsRef.current.map((s, j) =>
      j === i ? { ...s, openPath: slot.path } : s,
    );
    write(i, `── ${t('multiport.connected', { port: slot.path, baud: slot.baud })} ──`);
  };

  const stateLabel: Record<SlotState, string> = {
    disconnected: t('conn.state.disconnected'),
    connecting: t('conn.state.connecting'),
    connected: t('conn.state.connected'),
    error: t('multiport.error'),
  };

  return (
    <>
      <PageHeader
        title={t('multiport.title')}
        description={t('multiport.description', { n: SLOTS })}
      >
        <Button icon={RefreshCw} onClick={() => void refreshPorts()}>
          {t('conn.refresh')}
        </Button>
      </PageHeader>
      <Card title={t('multiport.ports')} icon={Cable}>
        <div className="slots">
          {slots.map((slot, i) => {
            const busy = slot.state === 'connected' || slot.state === 'connecting';
            return (
              <div
                key={i}
                className="slot"
                style={{ ['--slot-color' as string]: SLOT_COLORS[i] }}
                data-testid={`slot-${i}`}
              >
                <Select
                  value={pathOf(slot)}
                  disabled={busy}
                  options={
                    ports.length
                      ? ports.map((p) => ({
                          value: p.path,
                          label: p.description ? `${p.path} – ${p.description}` : p.path,
                        }))
                      : [{ value: '', label: t('conn.noPorts') }]
                  }
                  onChange={(path) => update(i, { path })}
                  data-testid={`slot-port-${i}`}
                />
                <Input
                  mono
                  list="baud-rates-mp"
                  style={{ width: 92 }}
                  defaultValue={slot.baud}
                  disabled={busy}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 50) update(i, { baud: n });
                    else e.target.value = String(slot.baud);
                  }}
                />
                <Button
                  size="sm"
                  variant={slot.state === 'connected' ? 'danger' : 'primary'}
                  icon={slot.state === 'connected' ? Unplug : Plug}
                  disabled={slot.state === 'connecting'}
                  onClick={() => void toggle(i)}
                  data-testid={`slot-toggle-${i}`}
                >
                  {slot.state === 'connected' ? t('conn.disconnect') : t('conn.connect')}
                </Button>
                <span
                  className="slot-state"
                  data-state={slot.state}
                  data-testid={`slot-state-${i}`}
                >
                  ● {stateLabel[slot.state]}
                </span>
                <span className="slot-counters mono" data-testid={`slot-counters-${i}`}>
                  RX {formatCount(shownCounters[i]?.rx ?? 0)} B · TX{' '}
                  {formatCount(shownCounters[i]?.tx ?? 0)} B
                </span>
              </div>
            );
          })}
          <datalist id="baud-rates-mp">
            {BAUD_RATES.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div className="bridge" data-testid="bridge">
          <ArrowLeftRight size={15} strokeWidth={2.2} aria-hidden />
          <Check
            checked={bridge.on}
            onChange={(on) => setBridge((b) => ({ ...b, on }))}
            switchStyle
            testId="bridge-on"
          >
            {t('multiport.bridge')}
          </Check>
          <span className="toolbar-label muted">{t('multiport.bridgeFrom')}</span>
          <Select<number>
            value={bridge.from}
            options={slots.map((_, i) => ({ value: i, label: t('multiport.slot', { n: i + 1 }) }))}
            onChange={(from) => setBridge((b) => ({ ...b, from }))}
            data-testid="bridge-from"
            style={{ width: 110 }}
          />
          <span className="toolbar-label muted">{t('multiport.bridgeTo')}</span>
          <Select<number>
            value={bridge.to}
            options={slots.map((_, i) => ({ value: i, label: t('multiport.slot', { n: i + 1 }) }))}
            onChange={(to) => setBridge((b) => ({ ...b, to }))}
            data-testid="bridge-to"
            style={{ width: 110 }}
          />
          <Check
            checked={bridge.both}
            onChange={(both) => setBridge((b) => ({ ...b, both }))}
            testId="bridge-both"
          >
            {t('multiport.bridgeBoth')}
          </Check>
          <span className="spacer" />
          {bridge.on && bridge.from === bridge.to ? (
            <span className="badge badge-warn">{t('multiport.bridgeSame')}</span>
          ) : (
            <span className="muted small" data-testid="bridge-bytes">
              {t('multiport.bridged', { bytes: formatCount(bridge.bytes) })}
            </span>
          )}
        </div>
      </Card>
      <Card
        title={view === 'combined' ? t('multiport.combined') : t('multiport.separate')}
        icon={ScrollText}
        fill
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              testId="multiport-view"
              options={[
                { value: 'combined', label: t('multiport.viewCombined'), icon: Rows3 },
                { value: 'separate', label: t('multiport.viewSeparate'), icon: Columns2 },
              ]}
            />
            <Button size="sm" variant="ghost" icon={Eraser} onClick={clearAll}>
              {t('common.clearOutput')}
            </Button>
          </>
        }
      >
        <div className="mp-view" hidden={view !== 'combined'}>
          <TextLog
            ref={log}
            maxLines={10000}
            emptyIcon={Cable}
            empty={t('multiport.empty')}
            testId="multiport-output"
          />
        </div>
        <div className="mp-grid" hidden={view !== 'separate'} data-testid="multiport-separate">
          {slots.map((slot, i) => (
            <section
              key={i}
              className="mp-panel"
              style={{ ['--slot-color' as string]: SLOT_COLORS[i] }}
              data-testid={`multiport-panel-${i}`}
            >
              <header>
                <span className="mp-dot" />
                <b>{t('multiport.slot', { n: i + 1 })}</b>
                <span className="mono muted">{slot.openPath || pathOf(slot) || '—'}</span>
                <span className="grow" />
                <span className="mono muted small">
                  RX {formatCount(shownCounters[i]?.rx ?? 0)} B · TX{' '}
                  {formatCount(shownCounters[i]?.tx ?? 0)} B
                </span>
              </header>
              <TextLog
                ref={(handle) => {
                  slotLogs.current[i] = handle;
                }}
                maxLines={5000}
                emptyIcon={Cable}
                empty={stateLabel[slot.state]}
                testId={`multiport-output-${i}`}
              />
            </section>
          ))}
        </div>
      </Card>
    </>
  );
}
