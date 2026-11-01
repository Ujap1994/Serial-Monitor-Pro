import { useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  commandPreview,
  MAX_STEP_PAUSE_MS,
  newCommand,
  NEWLINES,
  validateCommand,
  type Command,
  type CommandStep,
  type Newline,
} from '@shared/core/commands';
import { DATA_FORMATS, type DataFormat } from '@shared/core/format';
import { Modal } from '../components/Modal';
import { Button, Check, Field, Input, NumberInput, Select } from '../components/ui';
import { useHexChange } from '../components/useHexChange';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore } from '../state/app';

interface Props {
  command?: Command;
  onSave: (command: Command) => void;
  onClose: () => void;
}

export function CommandEditor({ command, onSave, onClose }: Props): ReactNode {
  const t = useT();
  const [cmd, setCmd] = useState<Command>(() => ({ ...newCommand(), ...command }));
  const [error, setError] = useState('');
  const hex = useHexChange();
  const crc = useStore(appStore, (s) => s.settings.transmitCrc);
  const update = (patch: Partial<Command>): void => {
    setCmd((c) => ({ ...c, ...patch }));
    setError('');
  };
  const setStep = (index: number, patch: Partial<CommandStep>): void =>
    update({ steps: cmd.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  const save = (): void => {
    const trimmed = { ...cmd, name: cmd.name.trim() };
    const result = validateCommand(trimmed, crc);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSave(trimmed);
  };

  return (
    <Modal
      title={command ? t('command.editTitle') : t('command.newTitle')}
      icon={command ? Pencil : Plus}
      onClose={onClose}
      testId="command-editor"
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} data-testid="command-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        <Field label={t('command.name')} className="span-2">
          <Input
            value={cmd.name}
            placeholder={t('command.namePlaceholder')}
            onChange={(e) => update({ name: e.target.value })}
            data-testid="command-name"
          />
        </Field>
        {!cmd.sequence && (
          <Field label={t('command.format')}>
            <Select<DataFormat>
              value={cmd.fmt}
              options={DATA_FORMATS}
              onChange={(fmt) => update({ fmt })}
            />
          </Field>
        )}
        <Field label={t('command.newline')} className={cmd.sequence ? 'span-2' : undefined}>
          <Select<Newline>
            value={cmd.newline}
            options={NEWLINES.map((n) => ({ value: n, label: t(`newline.${n}`) }))}
            onChange={(newline) => update({ newline })}
          />
        </Field>
        <div className="span-2 row">
          <Check
            checked={cmd.sequence}
            onChange={(sequence) =>
              update(
                sequence && !cmd.steps.length && cmd.data.trim()
                  ? { sequence, steps: [{ data: cmd.data, fmt: cmd.fmt, pauseMs: 0 }] }
                  : { sequence },
              )
            }
            testId="command-sequence"
            title={t('command.sequenceHint')}
          >
            {t('command.sequence')}
          </Check>
          <span className="muted small">{t('command.sequenceHint')}</span>
        </div>
        {cmd.sequence ? (
          <div className="span-2 steps-editor" data-testid="command-steps">
            <div className="steps-head">
              <span>#</span>
              <span>{t('command.format')}</span>
              <span>{t('command.data')}</span>
              <span>{t('command.stepPause')}</span>
              <span />
            </div>
            {cmd.steps.map((step, i) => (
              <div className="steps-row" key={i}>
                <span className="muted">{i + 1}</span>
                <Select<DataFormat>
                  value={step.fmt}
                  options={DATA_FORMATS}
                  onChange={(fmt) => setStep(i, { fmt })}
                />
                <Input
                  mono
                  value={step.data}
                  placeholder={t('command.dataPlaceholder')}
                  onChange={hex(step.fmt, (data) => setStep(i, { data }))}
                  data-testid={`command-step-data-${i}`}
                />
                <NumberInput
                  value={step.pauseMs}
                  min={0}
                  max={MAX_STEP_PAUSE_MS}
                  onChange={(pauseMs) => setStep(i, { pauseMs })}
                  data-testid={`command-step-pause-${i}`}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={Trash2}
                  title={t('common.delete')}
                  onClick={() => update({ steps: cmd.steps.filter((_, j) => j !== i) })}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                icon={Plus}
                onClick={() =>
                  update({
                    steps: [
                      ...cmd.steps,
                      {
                        data: '',
                        fmt: cmd.steps[cmd.steps.length - 1]?.fmt ?? cmd.fmt,
                        pauseMs: 100,
                      },
                    ],
                  })
                }
                data-testid="command-step-add"
              >
                {t('command.stepAdd')}
              </Button>
            </div>
          </div>
        ) : (
          <Field label={t('command.data')} className="span-2">
            <Input
              mono
              value={cmd.data}
              placeholder={t('command.dataPlaceholder')}
              onChange={hex(cmd.fmt, (data) => update({ data }))}
              data-testid="command-data"
              aria-invalid={Boolean(error)}
            />
          </Field>
        )}
        <Field label={t('command.delay')} hint={t('command.delayHint')}>
          <NumberInput
            value={cmd.delayMs}
            min={0}
            max={600000}
            onChange={(delayMs) => update({ delayMs })}
          />
        </Field>
        <Field label={t('command.periodic')} hint={t('command.periodicHint')}>
          <NumberInput
            value={cmd.periodicMs}
            min={10}
            max={3_600_000}
            onChange={(periodicMs) => update({ periodicMs })}
            data-testid="command-periodic"
          />
        </Field>
        <div className="field">
          <span>CRC</span>
          <Check
            checked={cmd.addCrc}
            onChange={(addCrc) => update({ addCrc })}
            testId="command-add-crc"
            title={t('command.addCrcHint')}
          >
            {t('command.addCrc')} ({crc.algorithm})
          </Check>
          <small className="field-hint">{t('command.addCrcHint')}</small>
        </div>
        <Field label={t('command.description')} className="span-2">
          <textarea
            className="input textarea"
            rows={2}
            value={cmd.description}
            placeholder={t('command.descriptionPlaceholder')}
            onChange={(e) => update({ description: e.target.value })}
            data-testid="command-description"
          />
        </Field>
        <button type="submit" hidden />
      </form>
      <div>
        <div className="section-title">{t('command.willSend')}</div>
        <div className="preview" data-testid="command-preview">
          {commandPreview(cmd, crc)}
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
    </Modal>
  );
}
