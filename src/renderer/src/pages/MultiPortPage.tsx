import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Cable, Eraser, Plug, RefreshCw, Unplug } from 'lucide-react';
import { StreamAssembler } from '@shared/core/assembler';
import { formatBytes, formatText } from '@shared/core/format';
import { BAUD_RATES } from '@shared/core/settings';
import { formatTimestamp } from '@shared/core/timestamp';
import { TextLog, type TextLogHandle } from '../components/LogView';
import { Button, Input, PageHeader, Select } from '../components/ui';
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
  const slotsRef = useLatest(slots);
  const assemblers = useRef(
    Array.from({ length: SLOTS }, () => new StreamAssembler('newline', 100)),
  );
  const timers = useRef<(ReturnType<typeof setTimeout> | null)[]>(
    Array.from({ length: SLOTS }, () => null),
  );

  const update = (i: number, patch: Partial<Slot>): void =>
    setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const write = (i: number, text: string): void => {
    const slot = slotsRef.current[i];
    log.current?.append(
      `[${formatTimestamp(Date.now(), 'time-ms')}] [${slot?.openPath || slot?.path || '?'}] ${text}`,
      'rx',
      SLOT_COLORS[i],
    );
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
    return multiPortBus.on((event) => {
      const i = Number(event.id.slice(2));
      if (!Number.isInteger(i) || i < 0 || i >= SLOTS) return;
      const assembler = assemblers.current[i] as StreamAssembler;
      if (event.kind === 'data') {
        for (const chunk of event.chunks) {
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
        <Button icon={Eraser} onClick={() => log.current?.clear()}>
          {t('common.clearOutput')}
        </Button>
      </PageHeader>
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
              <span className="slot-state" data-state={slot.state} data-testid={`slot-state-${i}`}>
                ● {stateLabel[slot.state]}
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
      <TextLog
        ref={log}
        maxLines={10000}
        emptyIcon={Cable}
        empty={t('multiport.empty')}
        testId="multiport-output"
      />
    </>
  );
}
