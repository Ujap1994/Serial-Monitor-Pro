import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OctagonX, Play, Square } from 'lucide-react';
import { formatTimestamp } from '@shared/core/timestamp';
import {
  checkStop,
  newStopState,
  stopNeedle,
  type StopCondition,
  type StopMode,
} from '@shared/core/stop';
import { TextLog, type TextLogHandle } from '../components/LogView';
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
import { setBusy, setStatus } from '../state/app';
import { disconnect, rxBus, systemLine } from '../state/serial';
import { alertDialog } from '../state/ui';

export function StopPage(): ReactNode {
  const t = useT();
  const [cond, setCond] = useState<StopCondition>({
    mode: 'pattern',
    pattern: '',
    patternFmt: 'ASCII',
    limit: 1000,
    disconnect: false,
  });
  const [active, setActive] = useState(false);
  const [state, setState] = useState(t('stop.inactive'));
  const log = useRef<TextLogHandle>(null);
  const condRef = useLatest(cond);

  const write = (text: string, kind: 'sys' | 'ok' | 'err' = 'sys'): void => {
    log.current?.append(`[${formatTimestamp(Date.now(), 'time')}] ${text}`, kind);
  };

  const finish = (reason: string): void => {
    setActive(false);
    setState(reason);
    write(reason);
  };

  useEffect(() => {
    setBusy('stop', active);
    if (!active) return;
    const stopState = newStopState();
    const evaluate = (raw: Uint8Array): void => {
      const c = condRef.current;
      const { hit, reason } = checkStop(c, stopState, raw);
      if (!hit) return;
      finish(t('stop.triggered', { reason }));
      systemLine(t('stop.monitorLine', { reason }));
      setStatus(t('stop.status', { reason }), 'warn');
      if (c.disconnect) void disconnect();
    };
    const off = rxBus.on((chunk) => evaluate(chunk.data));
    // The time limit must also fire while no data arrives – precisely the
    // situation it is configured for.
    const tick = setInterval(() => evaluate(new Uint8Array()), 250);
    return () => {
      off();
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const toggle = (): void => {
    if (active) {
      finish(t('stop.manual'));
      return;
    }
    if (cond.mode === 'pattern' && !stopNeedle(cond).length) {
      void alertDialog(t('stop.patternMissingTitle'), t('stop.patternMissing'), 'warn');
      return;
    }
    setActive(true);
    setState(t('stop.waiting'));
    write(t('stop.started'), 'ok');
  };

  const set = (patch: Partial<StopCondition>): void => setCond((c) => ({ ...c, ...patch }));

  return (
    <>
      <PageHeader title={t('stop.title')} description={t('stop.description')} />
      <Card title={t('stop.condition')} icon={OctagonX}>
        <div className="form-grid">
          <Field label={t('stop.trigger')}>
            <Select<StopMode>
              value={cond.mode}
              disabled={active}
              data-testid="stop-mode"
              options={[
                { value: 'pattern', label: t('stop.mode.pattern') },
                { value: 'bytes', label: t('stop.mode.bytes') },
                { value: 'lines', label: t('stop.mode.lines') },
                { value: 'seconds', label: t('stop.mode.seconds') },
              ]}
              onChange={(mode) => set(mode === 'seconds' ? { mode, limit: 60 } : { mode })}
            />
          </Field>
          {cond.mode === 'pattern' ? (
            <>
              <Field label={t('stop.pattern')}>
                <Input
                  mono
                  value={cond.pattern}
                  disabled={active}
                  placeholder={t('stop.patternPlaceholder')}
                  onChange={(e) => set({ pattern: e.target.value })}
                  data-testid="stop-pattern"
                />
              </Field>
              <Field label={t('command.format')}>
                <Select<'ASCII' | 'HEX'>
                  value={cond.patternFmt}
                  disabled={active}
                  options={['ASCII', 'HEX']}
                  onChange={(patternFmt) => set({ patternFmt })}
                />
              </Field>
            </>
          ) : (
            <Field label={cond.mode === 'seconds' ? t('stop.limitSeconds') : t('stop.limit')}>
              <NumberInput
                value={cond.limit}
                min={1}
                max={10_000_000}
                disabled={active}
                onChange={(limit) => set({ limit })}
              />
            </Field>
          )}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Check
            checked={cond.disconnect}
            onChange={(v) => set({ disconnect: v })}
            disabled={active}
          >
            {t('stop.alsoDisconnect')}
          </Check>
          <span className="spacer" />
          <span className={active ? 'badge badge-ok' : 'badge'} data-testid="stop-state">
            {state}
          </span>
          <Button
            variant={active ? 'danger' : 'success'}
            icon={active ? Square : Play}
            wide
            onClick={toggle}
            data-testid="stop-toggle"
          >
            {active ? t('stop.end') : t('stop.start')}
          </Button>
        </div>
      </Card>
      <TextLog
        ref={log}
        maxLines={500}
        emptyIcon={OctagonX}
        empty={t('stop.empty')}
        testId="stop-log"
      />
    </>
  );
}
