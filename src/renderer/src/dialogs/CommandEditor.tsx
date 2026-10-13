import { useState, type ReactNode } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
  commandPreview,
  newCommand,
  NEWLINES,
  validateCommand,
  type Command,
  type Newline,
} from '@shared/core/commands';
import { DATA_FORMATS, type DataFormat } from '@shared/core/format';
import { Modal } from '../components/Modal';
import { Button, Field, Input, NumberInput, Select } from '../components/ui';
import { useT } from '../lib/i18n';

interface Props {
  command?: Command;
  onSave: (command: Command) => void;
  onClose: () => void;
}

export function CommandEditor({ command, onSave, onClose }: Props): ReactNode {
  const t = useT();
  const [cmd, setCmd] = useState<Command>(() => ({ ...newCommand(), ...command }));
  const [error, setError] = useState('');
  const update = (patch: Partial<Command>): void => {
    setCmd((c) => ({ ...c, ...patch }));
    setError('');
  };

  const save = (): void => {
    const trimmed = { ...cmd, name: cmd.name.trim() };
    const result = validateCommand(trimmed);
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
        <Field label={t('command.format')}>
          <Select<DataFormat>
            value={cmd.fmt}
            options={DATA_FORMATS}
            onChange={(fmt) => update({ fmt })}
          />
        </Field>
        <Field label={t('command.newline')}>
          <Select<Newline>
            value={cmd.newline}
            options={NEWLINES.map((n) => ({ value: n, label: t(`newline.${n}`) }))}
            onChange={(newline) => update({ newline })}
          />
        </Field>
        <Field label={t('command.data')} className="span-2">
          <Input
            mono
            value={cmd.data}
            placeholder={t('command.dataPlaceholder')}
            onChange={(e) => update({ data: e.target.value })}
            data-testid="command-data"
            aria-invalid={Boolean(error)}
          />
        </Field>
        <Field label={t('command.delay')} hint={t('command.delayHint')}>
          <NumberInput
            value={cmd.delayMs}
            min={0}
            max={600000}
            onChange={(delayMs) => update({ delayMs })}
          />
        </Field>
        <button type="submit" hidden />
      </form>
      <div>
        <div className="section-title">{t('command.willSend')}</div>
        <div className="preview" data-testid="command-preview">
          {commandPreview(cmd)}
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
    </Modal>
  );
}
