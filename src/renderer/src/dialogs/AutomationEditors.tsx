import { useState, type ReactNode } from 'react';
import { CalendarClock, Zap } from 'lucide-react';
import {
  newSchedule,
  newTrigger,
  SCHEDULE_INTERVAL_MAX,
  TRIGGER_COOLDOWN_MAX,
  TRIGGER_MATCHES,
  triggerPatternError,
  type Schedule,
  type Trigger,
  type TriggerMatch,
} from '@shared/core/automation';
import { NEWLINES, type Newline } from '@shared/core/commands';
import { DATA_FORMATS, parseSendData, type DataFormat } from '@shared/core/format';
import { Modal } from '../components/Modal';
import { Button, Field, Input, NumberInput, Select } from '../components/ui';
import { useHexChange } from '../components/useHexChange';
import { useT } from '../lib/i18n';

function dataError(data: string, fmt: DataFormat): string {
  try {
    parseSendData(data, fmt);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function Footer({
  onClose,
  onSave,
  testId,
}: {
  onClose: () => void;
  onSave: () => void;
  testId: string;
}): ReactNode {
  const t = useT();
  return (
    <>
      <span className="spacer" />
      <Button onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" onClick={onSave} data-testid={testId}>
        {t('common.save')}
      </Button>
    </>
  );
}

function SendFields({
  data,
  fmt,
  newline,
  label,
  onChange,
  testId,
}: {
  data: string;
  fmt: DataFormat;
  newline: Newline;
  label: string;
  onChange: (patch: { data?: string; fmt?: DataFormat; newline?: Newline }) => void;
  testId: string;
}): ReactNode {
  const t = useT();
  const hex = useHexChange();
  return (
    <>
      <Field label={label} className="span-2">
        <Input
          mono
          value={data}
          onChange={hex(fmt, (data) => onChange({ data }))}
          data-testid={testId}
        />
      </Field>
      <Field label={t('command.format')}>
        <Select<DataFormat>
          value={fmt}
          options={DATA_FORMATS}
          onChange={(f) => onChange({ fmt: f })}
        />
      </Field>
      <Field label={t('command.newline')}>
        <Select<Newline>
          value={newline}
          options={NEWLINES.map((n) => ({ value: n, label: t(`newline.${n}`) }))}
          onChange={(n) => onChange({ newline: n })}
        />
      </Field>
    </>
  );
}

export function TriggerEditor({
  trigger,
  onSave,
  onClose,
}: {
  trigger?: Trigger;
  onSave: (trigger: Trigger) => void;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const [tr, setTr] = useState<Trigger>(() => ({ ...newTrigger(), ...trigger }));
  const hex = useHexChange();
  const [error, setError] = useState('');
  const update = (patch: Partial<Trigger>): void => {
    setTr((x) => ({ ...x, ...patch }));
    setError('');
  };
  const save = (): void => {
    const patternError = triggerPatternError(tr);
    if (patternError) {
      setError(
        patternError === 'empty'
          ? t('trigger.patternMissing')
          : `${t('trigger.pattern')}: ${patternError}`,
      );
      return;
    }
    const responseError = dataError(tr.response, tr.fmt);
    if (responseError) {
      setError(`${t('trigger.response')}: ${responseError}`);
      return;
    }
    onSave({ ...tr, name: tr.name.trim() });
  };
  return (
    <Modal
      title={trigger ? t('trigger.editTitle') : t('trigger.newTitle')}
      icon={Zap}
      onClose={onClose}
      testId="trigger-editor"
      footer={<Footer onClose={onClose} onSave={save} testId="trigger-save" />}
    >
      <div className="form-grid cols-2">
        <Field label={t('command.name')} className="span-2">
          <Input
            value={tr.name}
            onChange={(e) => update({ name: e.target.value })}
            data-testid="trigger-name"
          />
        </Field>
        <Field
          label={t('trigger.pattern')}
          className="span-2"
          hint={t(`trigger.matchHint.${tr.match}`)}
        >
          <Input
            mono
            value={tr.pattern}
            onChange={hex(tr.match, (pattern) => update({ pattern }))}
            data-testid="trigger-pattern"
          />
        </Field>
        <Field label={t('trigger.match')}>
          <Select<TriggerMatch>
            value={tr.match}
            options={TRIGGER_MATCHES.map((m) => ({ value: m, label: t(`trigger.match.${m}`) }))}
            onChange={(match) => update({ match })}
            data-testid="trigger-match"
          />
        </Field>
        <Field label={t('trigger.cooldown')} hint={t('trigger.cooldownHint')}>
          <NumberInput
            value={tr.cooldownMs}
            min={0}
            max={TRIGGER_COOLDOWN_MAX}
            onChange={(cooldownMs) => update({ cooldownMs })}
          />
        </Field>
        <SendFields
          data={tr.response}
          fmt={tr.fmt}
          newline={tr.newline}
          label={t('trigger.response')}
          onChange={update}
          testId="trigger-response"
        />
      </div>
      <p className="muted small">{t('trigger.hint')}</p>
      {error && <div className="notice">{error}</div>}
    </Modal>
  );
}

export function ScheduleEditor({
  schedule,
  onSave,
  onClose,
}: {
  schedule?: Schedule;
  onSave: (schedule: Schedule) => void;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const [s, setS] = useState<Schedule>(() => ({ ...newSchedule(), ...schedule }));
  const [error, setError] = useState('');
  const update = (patch: Partial<Schedule>): void => {
    setS((x) => ({ ...x, ...patch }));
    setError('');
  };
  const save = (): void => {
    if (!s.data.trim()) {
      setError(t('step.dataMissing'));
      return;
    }
    const err = dataError(s.data, s.fmt);
    if (err) {
      setError(err);
      return;
    }
    onSave({ ...s, name: s.name.trim() });
  };
  return (
    <Modal
      title={schedule ? t('schedule.editTitle') : t('schedule.newTitle')}
      icon={CalendarClock}
      onClose={onClose}
      testId="schedule-editor"
      footer={<Footer onClose={onClose} onSave={save} testId="schedule-save" />}
    >
      <div className="form-grid cols-2">
        <Field label={t('command.name')}>
          <Input
            value={s.name}
            onChange={(e) => update({ name: e.target.value })}
            data-testid="schedule-name"
          />
        </Field>
        <Field label={t('schedule.interval')} hint={t('schedule.intervalHint')}>
          <NumberInput
            value={s.intervalS}
            min={1}
            max={SCHEDULE_INTERVAL_MAX}
            onChange={(intervalS) => update({ intervalS })}
            data-testid="schedule-interval"
          />
        </Field>
        <SendFields
          data={s.data}
          fmt={s.fmt}
          newline={s.newline}
          label={t('command.data')}
          onChange={update}
          testId="schedule-data"
        />
      </div>
      {error && <div className="notice">{error}</div>}
    </Modal>
  );
}
