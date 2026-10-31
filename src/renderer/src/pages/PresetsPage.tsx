import { useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileDown,
  FileUp,
  Info,
  ListChecks,
  Pencil,
  Plus,
  Repeat,
  SendHorizontal,
  Square,
  Trash2,
} from 'lucide-react';
import { commandBytes, commandPreview, type Command } from '@shared/core/commands';
import { Button, Card, Empty, PageHeader } from '../components/ui';
import { CommandEditor } from '../dialogs/CommandEditor';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, setCommands } from '../state/app';
import { exportCommands, importCommands } from '../state/commands';
import { sendCommand, startPeriodic, stopPeriodic } from '../state/serial';
import { alertDialog, confirmDialog } from '../state/ui';

export function PresetsPage(): ReactNode {
  const t = useT();
  const commands = useStore(appStore, (s) => s.commands);
  const crc = useStore(appStore, (s) => s.settings.transmitCrc);
  const periodic = useStore(appStore, (s) => s.periodic);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const index = Math.min(selected, commands.length - 1);
  const current: Command | undefined = commands[index];

  const requireSelection = (): boolean => {
    if (current) return true;
    void alertDialog(t('presets.noSelectionTitle'), t('presets.noSelection'));
    return false;
  };

  const move = (delta: number): void => {
    const target = index + delta;
    if (!current || target < 0 || target >= commands.length) return;
    const next = [...commands];
    [next[index], next[target]] = [next[target] as Command, current];
    setCommands(next);
    setSelected(target);
  };

  const remove = async (): Promise<void> => {
    if (!requireSelection() || !current) return;
    const ok = await confirmDialog(
      t('presets.deleteTitle'),
      t('presets.deleteQuestion', { name: current.name }),
      t('common.delete'),
      t('common.cancel'),
      true,
    );
    if (ok) setCommands(commands.filter((_, i) => i !== index));
  };

  return (
    <>
      <PageHeader title={t('presets.title')} description={t('presets.description')}>
        <Button icon={FileUp} onClick={() => void importCommands()}>
          {t('common.import')}
        </Button>
        <Button icon={FileDown} onClick={() => void exportCommands()}>
          {t('common.export')}
        </Button>
      </PageHeader>

      <div className="split">
        <Card title={t('presets.listTitle', { count: commands.length })} icon={ListChecks} fill>
          <div className="row">
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              onClick={() => setEditing({ index: null })}
              data-testid="preset-new"
            >
              {t('common.new')}
            </Button>
            <Button
              size="sm"
              icon={Pencil}
              onClick={() => requireSelection() && setEditing({ index })}
            >
              {t('common.edit')}
            </Button>
            <Button
              size="sm"
              icon={Copy}
              onClick={() => {
                if (!requireSelection() || !current) return;
                const next = [...commands];
                next.splice(index + 1, 0, {
                  ...current,
                  name: `${current.name} ${t('presets.copySuffix')}`,
                });
                setCommands(next);
                setSelected(index + 1);
              }}
            >
              {t('common.duplicate')}
            </Button>
            <Button size="sm" icon={Trash2} onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
            <span className="spacer" />
            <Button
              size="sm"
              iconOnly
              icon={ArrowUp}
              onClick={() => move(-1)}
              title={t('common.moveUp')}
            >
              {t('common.moveUp')}
            </Button>
            <Button
              size="sm"
              iconOnly
              icon={ArrowDown}
              onClick={() => move(1)}
              title={t('common.moveDown')}
            >
              {t('common.moveDown')}
            </Button>
          </div>
          <div className="list" role="listbox" data-testid="preset-list">
            {commands.length === 0 && <Empty icon={ListChecks}>{t('presets.empty')}</Empty>}
            {commands.map((c, i) => (
              <div
                key={i}
                role="option"
                className="list-item"
                title={c.description || undefined}
                aria-selected={i === index}
                onClick={() => setSelected(i)}
                onDoubleClick={() => void sendCommand(c)}
              >
                <span className="title">{c.name}</span>
                <span className="badge">{c.fmt}</span>
                {c.addCrc && <span className="badge badge-crc">+CRC</span>}
                {!c.enabled && <span className="badge">{t('presets.skipped')}</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('presets.details')} icon={Info} fill>
          {current ? (
            <>
              <dl className="detail selectable">
                <dt>{t('command.name')}</dt>
                <dd>{current.name}</dd>
                <dt>{t('command.format')}</dt>
                <dd>{current.fmt}</dd>
                <dt>{t('command.data')}</dt>
                <dd className="mono">{current.data || '—'}</dd>
                <dt>{t('command.newline')}</dt>
                <dd>{t(`newline.${current.newline}`)}</dd>
                <dt>{t('command.delay')}</dt>
                <dd>{current.delayMs} ms</dd>
                <dt>{t('presets.crc')}</dt>
                <dd>
                  {current.addCrc
                    ? t('presets.crcOn', { algorithm: crc.algorithm })
                    : t('presets.crcOff')}
                </dd>
                <dt>{t('presets.inTable')}</dt>
                <dd>{current.enabled ? t('presets.active') : t('presets.skipped')}</dd>
                <dt>{t('command.periodic')}</dt>
                <dd>{current.periodicMs} ms</dd>
                {current.description && (
                  <>
                    <dt>{t('command.description')}</dt>
                    <dd className="pre-wrap" data-testid="preset-description">
                      {current.description}
                    </dd>
                  </>
                )}
              </dl>
              <div>
                <div className="section-title">{t('command.willSend')}</div>
                <div className="preview" data-testid="preset-preview">
                  {commandPreview(current, crc)}
                </div>
              </div>
              <span className="grow" />
              <div className="row nowrap">
                <Button
                  variant="success"
                  icon={SendHorizontal}
                  className="grow"
                  onClick={() => void sendCommand(current)}
                  data-testid="preset-send"
                >
                  {t('presets.sendSelected')}
                </Button>
                <Button
                  variant={periodic ? 'danger' : 'default'}
                  icon={periodic ? Square : Repeat}
                  data-testid="preset-periodic"
                  title={periodic ? t('periodic.running', { name: periodic }) : undefined}
                  onClick={() => {
                    if (periodic) {
                      stopPeriodic();
                      return;
                    }
                    const cmd = current;
                    void startPeriodic({
                      label: cmd.name,
                      next: () => ({
                        data: commandBytes(cmd, appStore.get().settings.transmitCrc),
                        fmt: cmd.fmt,
                        label: cmd.name,
                      }),
                      intervalMs: () => cmd.periodicMs,
                    });
                  }}
                >
                  {periodic
                    ? t('periodic.stop')
                    : t('presets.periodic', { ms: current.periodicMs })}
                </Button>
              </div>
            </>
          ) : (
            <Empty icon={SendHorizontal}>{t('presets.noneSelected')}</Empty>
          )}
        </Card>
      </div>

      {editing && (
        <CommandEditor
          command={editing.index === null ? undefined : commands[editing.index]}
          onClose={() => setEditing(null)}
          onSave={(cmd) => {
            if (editing.index === null) {
              setCommands([...commands, cmd]);
              setSelected(commands.length);
            } else {
              setCommands(commands.map((c, i) => (i === editing.index ? cmd : c)));
            }
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
