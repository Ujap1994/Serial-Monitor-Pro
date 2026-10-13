import { useState, type ReactNode } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { NEWLINES, type Newline } from '@shared/core/commands';
import { DATA_FORMATS, InputError, parseSendData, type DataFormat } from '@shared/core/format';
import { newStep, type Step, type StepKind } from '@shared/core/steps';
import { Modal } from '../components/Modal';
import { Button, Field, Input, NumberInput, Select } from '../components/ui';
import { useT } from '../lib/i18n';

interface Props {
  step?: Step;
  onSave: (step: Step) => void;
  onClose: () => void;
}

export function StepEditor({ step, onSave, onClose }: Props): ReactNode {
  const t = useT();
  const [s, setS] = useState<Step>(() => ({ ...newStep(), ...step }));
  const [error, setError] = useState('');
  const update = (patch: Partial<Step>): void => {
    setS((x) => ({ ...x, ...patch }));
    setError('');
  };

  const save = (): void => {
    if (s.kind === 'send' || s.kind === 'expect') {
      if (!s.data.trim()) {
        setError(t('step.dataMissing'));
        return;
      }
      try {
        parseSendData(s.data, s.fmt);
      } catch (err) {
        setError(err instanceof InputError ? err.message : String(err));
        return;
      }
    }
    onSave(s);
  };

  const hints: Record<StepKind, string> = {
    send: t('step.hint.send'),
    wait: t('step.hint.wait'),
    expect: t('step.hint.expect'),
    log: t('step.hint.log'),
  };

  return (
    <Modal
      title={step ? t('step.editTitle') : t('step.newTitle')}
      icon={step ? Pencil : Plus}
      onClose={onClose}
      testId="step-editor"
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} data-testid="step-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        style={{ gridTemplateColumns: '1fr 1fr' }}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label={t('step.kind')}>
          <Select<StepKind>
            value={s.kind}
            data-testid="step-kind"
            options={[
              { value: 'send', label: t('step.kind.send') },
              { value: 'wait', label: t('step.kind.wait') },
              { value: 'expect', label: t('step.kind.expect') },
              { value: 'log', label: t('step.kind.log') },
            ]}
            onChange={(kind) => update({ kind })}
          />
        </Field>
        {(s.kind === 'send' || s.kind === 'expect') && (
          <Field label={t('command.format')}>
            <Select<DataFormat>
              value={s.fmt}
              options={DATA_FORMATS}
              onChange={(fmt) => update({ fmt })}
            />
          </Field>
        )}
        {(s.kind === 'send' || s.kind === 'expect') && (
          <Field
            label={s.kind === 'send' ? t('command.data') : t('step.pattern')}
            className="span-2"
          >
            <Input
              mono
              value={s.data}
              onChange={(e) => update({ data: e.target.value })}
              aria-invalid={Boolean(error)}
              data-testid="step-data"
            />
          </Field>
        )}
        {s.kind === 'send' && (
          <Field label={t('command.newline')}>
            <Select<Newline>
              value={s.newline}
              options={NEWLINES.map((n) => ({ value: n, label: t(`newline.${n}`) }))}
              onChange={(newline) => update({ newline })}
            />
          </Field>
        )}
        {(s.kind === 'wait' || s.kind === 'expect') && (
          <Field label={s.kind === 'wait' ? t('step.duration') : t('step.timeout')}>
            <NumberInput
              value={s.value}
              min={0}
              max={600000}
              onChange={(value) => update({ value })}
            />
          </Field>
        )}
        {s.kind === 'log' && (
          <Field label={t('step.note')} className="span-2">
            <Input value={s.note} onChange={(e) => update({ note: e.target.value })} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
      <div className="notice info">{hints[s.kind]}</div>
      {error && <div className="notice">{error}</div>}
    </Modal>
  );
}
