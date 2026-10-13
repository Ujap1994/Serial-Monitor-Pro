import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eraser,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  Workflow,
} from 'lucide-react';
import { concatBytes, indexOfBytes } from '@shared/core/bytes';
import { parseSendData } from '@shared/core/format';
import { describeStep, type Step } from '@shared/core/steps';
import { formatTimestamp } from '@shared/core/timestamp';
import { TextLog, type TextLogHandle } from '../components/LogView';
import { Button, Card, Check, Empty, PageHeader } from '../components/ui';
import { StepEditor } from '../dialogs/StepEditor';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { useStore } from '../lib/store';
import { appStore, setBusy, setSteps } from '../state/app';
import { isConnected, rxBus, sendCommand } from '../state/serial';
import { alertDialog } from '../state/ui';

interface Run {
  active: boolean;
  index: number;
  timer: ReturnType<typeof setTimeout> | null;
  expect: { needle: Uint8Array; buffer: Uint8Array } | null;
}

export function AutomationPage(): ReactNode {
  const t = useT();
  const steps = useStore(appStore, (s) => s.steps);
  const connected = useStore(appStore, (s) => s.connection === 'connected');
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [loop, setLoop] = useState(false);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [status, setStatus] = useState(t('common.ready'));
  const log = useRef<TextLogHandle>(null);
  const run = useRef<Run>({ active: false, index: 0, timer: null, expect: null });
  const loopRef = useLatest(loop);
  const index = Math.min(selected, steps.length - 1);

  const write = (text: string, kind: 'rx' | 'sys' | 'ok' | 'err' = 'rx'): void => {
    log.current?.append(`[${formatTimestamp(Date.now(), 'time-ms')}] ${text}`, kind);
  };

  const stop = (reason: string, kind: 'sys' | 'ok' | 'err' = 'sys'): void => {
    const r = run.current;
    r.active = false;
    r.expect = null;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    setRunning(false);
    setCurrent(-1);
    setStatus(reason);
    setBusy('automation', false);
    write(`── ${reason} ──`, kind);
  };

  const later = (ms: number, fn: () => void): void => {
    const r = run.current;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(fn, ms);
  };

  /**
   * Executes the next step. Driven by timers instead of a waiting loop – the
   * interface stays responsive and "Cancel" takes effect immediately.
   */
  const advance = async (): Promise<void> => {
    const r = run.current;
    if (!r.active) return;
    if (!isConnected()) return stop(t('automation.stopped.disconnected'), 'err');
    const list = appStore.get().steps;
    if (r.index >= list.length) {
      if (!loopRef.current) return stop(t('automation.stopped.done'), 'ok');
      r.index = 0;
      write(`── ${t('automation.repeat')} ──`, 'sys');
    }
    const step = list[r.index] as Step;
    setCurrent(r.index);
    setStatus(t('automation.step', { n: r.index + 1, total: list.length }));

    switch (step.kind) {
      case 'send': {
        const ok = await sendCommand(
          {
            name: t('automation.stepName', { n: r.index + 1 }),
            data: step.data,
            fmt: step.fmt,
            newline: step.newline,
            delayMs: 0,
            enabled: true,
          },
          true,
        );
        if (!r.active) return;
        if (!ok) return stop(t('automation.stopped.sendFailed'), 'err');
        write(t('automation.sent', { data: step.data }));
        r.index++;
        later(10, () => void advance());
        return;
      }
      case 'wait':
        write(t('automation.waiting', { ms: step.value }));
        r.index++;
        later(Math.max(10, step.value), () => void advance());
        return;
      case 'expect': {
        let needle: Uint8Array;
        try {
          needle = parseSendData(step.data, step.fmt);
        } catch {
          return stop(t('automation.stopped.patternInvalid'), 'err');
        }
        write(t('automation.expecting', { data: step.data, ms: step.value }));
        r.expect = { needle, buffer: new Uint8Array() };
        // A separate timer only for the timeout – the match itself comes from the data.
        later(Math.max(10, step.value), () => {
          if (r.active && r.expect) stop(t('automation.stopped.timeout'), 'err');
        });
        return;
      }
      case 'log':
        write(t('automation.note', { note: step.note }), 'sys');
        r.index++;
        later(10, () => void advance());
        return;
    }
  };

  useEffect(() => {
    return rxBus.on((chunk) => {
      const r = run.current;
      if (!r.active || !r.expect) return;
      let buffer = concatBytes(r.expect.buffer, chunk.data);
      if (buffer.length > 65536) buffer = buffer.slice(-8192);
      r.expect.buffer = buffer;
      if (indexOfBytes(buffer, r.expect.needle) >= 0) {
        write(t('automation.received'), 'ok');
        r.expect = null;
        r.index++;
        later(10, () => void advance());
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected && run.current.active) stop(t('automation.stopped.disconnected'), 'err');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(
    () => () => {
      if (run.current.timer) clearTimeout(run.current.timer);
    },
    [],
  );

  const start = async (): Promise<void> => {
    if (!steps.length) {
      await alertDialog(t('automation.noStepsTitle'), t('automation.noSteps'));
      return;
    }
    if (!isConnected()) {
      await alertDialog(t('error.notConnectedTitle'), t('error.notConnected'), 'warn');
      return;
    }
    run.current = { active: true, index: 0, timer: null, expect: null };
    setRunning(true);
    setBusy('automation', true);
    write(`── ${t('automation.started')} ──`, 'ok');
    void advance();
  };

  const move = (delta: number): void => {
    const target = index + delta;
    if (index < 0 || target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target] as Step, next[index] as Step];
    setSteps(next);
    setSelected(target);
  };

  return (
    <>
      <PageHeader title={t('automation.title')} description={t('automation.description')} />
      <div className="split">
        <Card title={t('automation.steps', { count: steps.length })} icon={Workflow} fill>
          <div className="row">
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              disabled={running}
              onClick={() => setEditing({ index: null })}
              data-testid="step-new"
            >
              {t('common.new')}
            </Button>
            <Button
              size="sm"
              icon={Pencil}
              disabled={running || index < 0}
              onClick={() => setEditing({ index })}
            >
              {t('common.edit')}
            </Button>
            <Button
              size="sm"
              icon={Trash2}
              disabled={running || index < 0}
              onClick={() => setSteps(steps.filter((_, i) => i !== index))}
            >
              {t('common.delete')}
            </Button>
            <span className="spacer" />
            <Button
              size="sm"
              iconOnly
              icon={ArrowUp}
              disabled={running}
              onClick={() => move(-1)}
              title={t('common.moveUp')}
            >
              {t('common.moveUp')}
            </Button>
            <Button
              size="sm"
              iconOnly
              icon={ArrowDown}
              disabled={running}
              onClick={() => move(1)}
              title={t('common.moveDown')}
            >
              {t('common.moveDown')}
            </Button>
          </div>
          <div className="list" role="listbox" data-testid="step-list">
            {steps.length === 0 && <Empty icon={Workflow}>{t('automation.empty')}</Empty>}
            {steps.map((s, i) => (
              <div
                key={i}
                role="option"
                aria-selected={i === index && !running}
                className={i === current ? 'list-item running' : 'list-item'}
                onClick={() => setSelected(i)}
                onDoubleClick={() => !running && setEditing({ index: i })}
              >
                <span className="badge">{i + 1}</span>
                <span className="title mono">{describeStep(s)}</span>
              </div>
            ))}
          </div>
          <div className="row">
            <Button
              variant={running ? 'danger' : 'success'}
              icon={running ? Square : Play}
              wide
              onClick={() => (running ? stop(t('automation.stopped.manual')) : void start())}
              data-testid="automation-run"
            >
              {running ? t('automation.cancel') : t('automation.start')}
            </Button>
            <Check checked={loop} onChange={setLoop}>
              {t('common.repeat')}
            </Check>
            <span className="spacer" />
            <span className="muted" data-testid="automation-status">
              {status}
            </span>
          </div>
        </Card>
        <Card
          title={t('automation.protocol')}
          fill
          actions={
            <Button size="sm" variant="ghost" icon={Eraser} onClick={() => log.current?.clear()}>
              {t('common.clearOutput')}
            </Button>
          }
        >
          <TextLog
            ref={log}
            maxLines={3000}
            emptyIcon={Workflow}
            empty={t('automation.logEmpty')}
            testId="automation-log"
          />
        </Card>
      </div>
      {editing && (
        <StepEditor
          step={editing.index === null ? undefined : steps[editing.index]}
          onClose={() => setEditing(null)}
          onSave={(step) => {
            if (editing.index === null) {
              setSteps([...steps, step]);
              setSelected(steps.length);
            } else {
              setSteps(steps.map((s, i) => (i === editing.index ? step : s)));
            }
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
