import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Circle,
  Eraser,
  Pencil,
  Play,
  Plus,
  ScrollText,
  Square,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react';
import type { Schedule, Trigger } from '@shared/core/automation';
import { newCommand } from '@shared/core/commands';
import { parseSendData } from '@shared/core/format';
import { describeStep, ResponseWatcher, type Step } from '@shared/core/steps';
import { formatTimestamp } from '@shared/core/timestamp';
import { TextLog, type TextLogHandle } from '../components/LogView';
import { Button, Card, Check, Empty, PageHeader, Segmented } from '../components/ui';
import { ScheduleEditor, TriggerEditor } from '../dialogs/AutomationEditors';
import { StepEditor } from '../dialogs/StepEditor';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { useStore } from '../lib/store';
import { appStore, setSteps } from '../state/app';
import {
  automationLog,
  automationStore,
  setSchedulerOn,
  setSchedules,
  setSequenceRunning,
  setTriggers,
  setTriggersOn,
  startRecording,
  stopRecording,
} from '../state/automation';
import { isConnected, rxBus, sendCommand } from '../state/serial';
import { alertDialog } from '../state/ui';

interface Run {
  active: boolean;
  index: number;
  timer: ReturnType<typeof setTimeout> | null;
  watcher: ResponseWatcher;
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
  const [section, setSection] = useState<'sequence' | 'triggers' | 'schedules'>('sequence');
  const recording = useStore(automationStore, (a) => a.recording);
  const recorded = useStore(automationStore, (a) => a.recorded);
  const triggersOn = useStore(automationStore, (a) => a.triggersOn);
  const schedulerOn = useStore(automationStore, (a) => a.schedulerOn);
  const log = useRef<TextLogHandle>(null);
  const run = useRef<Run>({
    active: false,
    index: 0,
    timer: null,
    watcher: new ResponseWatcher(),
  });
  const loopRef = useLatest(loop);
  const index = Math.min(selected, steps.length - 1);

  const write = (text: string, kind: 'rx' | 'sys' | 'ok' | 'err' = 'rx'): void => {
    log.current?.append(`[${formatTimestamp(Date.now(), 'time-ms')}] ${text}`, kind);
  };

  const stop = (reason: string, kind: 'sys' | 'ok' | 'err' = 'sys'): void => {
    const r = run.current;
    r.active = false;
    r.watcher.reset();
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    setRunning(false);
    setCurrent(-1);
    setStatus(reason);
    setSequenceRunning(false);
    write(`── ${reason} ──`, kind);
  };

  const later = (ms: number, fn: () => void): void => {
    const r = run.current;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(fn, ms);
  };

  const answered = (): void => {
    write(t('automation.received'), 'ok');
    run.current.index++;
    later(10, () => void advance());
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
        r.watcher.sent();
        const ok = await sendCommand(
          newCommand({
            name: t('automation.stepName', { n: r.index + 1 }),
            data: step.data,
            fmt: step.fmt,
            newline: step.newline,
            delayMs: 0,
          }),
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
        // A separate timer only for the timeout – the match itself comes from the data.
        later(Math.max(10, step.value), () => {
          if (r.active && r.watcher.waiting) stop(t('automation.stopped.timeout'), 'err');
        });
        if (r.watcher.expect(needle)) answered();
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
      if (r.active && r.watcher.push(chunk.data)) answered();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => automationLog.on(({ text, kind }) => log.current?.append(text, kind)), []);

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
    run.current = { active: true, index: 0, timer: null, watcher: new ResponseWatcher() };
    if (automationStore.get().recording) stopRecording();
    setRunning(true);
    setSequenceRunning(true);
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
      <PageHeader title={t('automation.title')} description={t('automation.description')}>
        <Segmented
          value={section}
          onChange={setSection}
          testId="automation-section"
          options={[
            { value: 'sequence', label: t('automation.section.sequence'), icon: Workflow },
            {
              value: 'triggers',
              label: (
                <>
                  {t('automation.section.triggers')}
                  {triggersOn && <span className="tab-dot" />}
                </>
              ),
              icon: Zap,
            },
            {
              value: 'schedules',
              label: (
                <>
                  {t('automation.section.schedules')}
                  {schedulerOn && <span className="tab-dot" />}
                </>
              ),
              icon: CalendarClock,
            },
          ]}
        />
      </PageHeader>
      <div className="split">
        {section === 'triggers' && <TriggerSection />}
        {section === 'schedules' && <ScheduleSection />}
        {section === 'sequence' && (
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
              <Button
                size="sm"
                variant={recording ? 'danger' : 'default'}
                icon={recording ? Square : Circle}
                disabled={running}
                title={t('macro.tip')}
                onClick={() => (recording ? stopRecording() : startRecording())}
                data-testid="macro-record"
              >
                {recording ? t('macro.stop', { count: recorded }) : t('macro.record')}
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
        )}
        <Card
          title={t('automation.protocol')}
          icon={ScrollText}
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

/** List with toolbar for triggers and schedules (same handling as the sequence list). */
function ItemList<T extends { name: string; enabled: boolean }>({
  items,
  counts,
  describe,
  onChange,
  editor,
  testId,
}: {
  items: T[];
  counts: readonly number[];
  describe: (item: T) => string;
  onChange: (items: T[]) => void;
  editor: (item: T | undefined, save: (item: T) => void, close: () => void) => ReactNode;
  testId: string;
}): ReactNode {
  const t = useT();
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const index = Math.min(selected, items.length - 1);
  return (
    <>
      <div className="row">
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={() => setEditing({ index: null })}
          data-testid={`${testId}-new`}
        >
          {t('common.new')}
        </Button>
        <Button size="sm" icon={Pencil} disabled={index < 0} onClick={() => setEditing({ index })}>
          {t('common.edit')}
        </Button>
        <Button
          size="sm"
          icon={Trash2}
          disabled={index < 0}
          onClick={() => onChange(items.filter((_, i) => i !== index))}
        >
          {t('common.delete')}
        </Button>
      </div>
      <div className="list" role="listbox" data-testid={`${testId}-list`}>
        {items.length === 0 && <Empty icon={Zap}>{t('automation.listEmpty')}</Empty>}
        {items.map((item, i) => (
          <div
            key={i}
            role="option"
            aria-selected={i === index}
            className="list-item"
            onClick={() => setSelected(i)}
            onDoubleClick={() => setEditing({ index: i })}
          >
            <span onClick={(e) => e.stopPropagation()}>
              <Check
                checked={item.enabled}
                onChange={(enabled) =>
                  onChange(items.map((x, j) => (j === i ? { ...x, enabled } : x)))
                }
                title={t('automation.itemEnabled')}
              >
                {''}
              </Check>
            </span>
            <span className="title">
              <b>{item.name || '—'}</b>
              <span className="sub mono">{describe(item)}</span>
            </span>
            <span className="badge" title={t('automation.count')}>
              {counts[i] ?? 0}×
            </span>
          </div>
        ))}
      </div>
      {editing &&
        editor(
          editing.index === null ? undefined : items[editing.index],
          (item) => {
            if (editing.index === null) {
              onChange([...items, item]);
              setSelected(items.length);
            } else {
              onChange(items.map((x, i) => (i === editing.index ? item : x)));
            }
            setEditing(null);
          },
          () => setEditing(null),
        )}
    </>
  );
}

function TriggerSection(): ReactNode {
  const t = useT();
  const triggers = useStore(appStore, (s) => s.settings.triggers);
  const on = useStore(automationStore, (a) => a.triggersOn);
  const counts = useStore(automationStore, (a) => a.triggerCounts);
  return (
    <Card title={t('trigger.title', { count: triggers.length })} icon={Zap} fill>
      <p className="muted small">{t('trigger.description')}</p>
      <ItemList<Trigger>
        items={triggers}
        counts={counts}
        testId="trigger"
        onChange={setTriggers}
        describe={(tr) =>
          t('trigger.describe', {
            match: t(`trigger.match.${tr.match}`),
            pattern: tr.pattern,
            response: tr.response || '—',
          })
        }
        editor={(item, save, close) => (
          <TriggerEditor trigger={item} onSave={save} onClose={close} />
        )}
      />
      <div className="row">
        <Check checked={on} onChange={setTriggersOn} switchStyle testId="triggers-on">
          {t('trigger.enable')}
        </Check>
        <span className="spacer" />
        <span className="muted" data-testid="trigger-total">
          {t('automation.fired', { count: counts.reduce((a, b) => a + (b ?? 0), 0) })}
        </span>
      </div>
    </Card>
  );
}

function ScheduleSection(): ReactNode {
  const t = useT();
  const schedules = useStore(appStore, (s) => s.settings.schedules);
  const on = useStore(automationStore, (a) => a.schedulerOn);
  const counts = useStore(automationStore, (a) => a.scheduleCounts);
  return (
    <Card title={t('schedule.title', { count: schedules.length })} icon={CalendarClock} fill>
      <p className="muted small">{t('schedule.description')}</p>
      <ItemList<Schedule>
        items={schedules}
        counts={counts}
        testId="schedule"
        onChange={setSchedules}
        describe={(s) =>
          t('schedule.describe', { seconds: s.intervalS, fmt: s.fmt, data: s.data || '—' })
        }
        editor={(item, save, close) => (
          <ScheduleEditor schedule={item} onSave={save} onClose={close} />
        )}
      />
      <div className="row">
        <Check checked={on} onChange={setSchedulerOn} switchStyle testId="scheduler-on">
          {t('schedule.enable')}
        </Check>
        <span className="spacer" />
        <span className="muted" data-testid="schedule-total">
          {t('automation.sentCount', { count: counts.reduce((a, b) => a + (b ?? 0), 0) })}
        </span>
      </div>
    </Card>
  );
}
