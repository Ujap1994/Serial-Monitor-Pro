// Replay a session capture: it becomes a simulated device in the port list.

import { useEffect, useState, type ReactNode } from 'react';
import { FolderOpen, History, Trash2 } from 'lucide-react';
import { formatCount } from '@shared/i18n';
import { formatDuration } from '@shared/core/capture';
import {
  DEFAULT_REPLAY,
  REPLAY_SPEEDS,
  type ReplayMode,
  type ReplayOptions,
} from '@shared/core/replay';
import type { ReplayInfo } from '@shared/ipc';
import { Modal } from '../components/Modal';
import { Button, Check, Field, Segmented, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { appStore, updateSettings } from '../state/app';
import { refreshPorts } from '../state/serial';
import { alertDialog, toast } from '../state/ui';

function ReplayOptionsEditor({
  value,
  onChange,
  testId,
}: {
  value: ReplayOptions;
  onChange: (options: ReplayOptions) => void;
  testId: string;
}): ReactNode {
  const t = useT();
  return (
    <div className="replay-options">
      <Segmented<ReplayMode>
        value={value.mode}
        options={[
          { value: 'answer', label: t('replay.modeAnswer') },
          { value: 'timed', label: t('replay.modeTimed') },
        ]}
        onChange={(mode) => onChange({ ...value, mode })}
        testId={`${testId}-mode`}
      />
      <Field label={t('replay.speed')}>
        <Select<number>
          value={value.speed}
          options={REPLAY_SPEEDS.map((speed) => ({ value: speed, label: `× ${speed}` }))}
          onChange={(speed) => onChange({ ...value, speed })}
          data-testid={`${testId}-speed`}
          style={{ width: 90 }}
        />
      </Field>
      {value.mode === 'timed' && (
        <Check
          checked={value.loop}
          onChange={(loop) => onChange({ ...value, loop })}
          testId={`${testId}-loop`}
        >
          {t('replay.loop')}
        </Check>
      )}
    </div>
  );
}

export function ReplayDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const [options, setOptions] = useState<ReplayOptions>({ ...DEFAULT_REPLAY });
  const [loaded, setLoaded] = useState<ReplayInfo[]>([]);

  useEffect(() => {
    void window.smp.replay.list().then(setLoaded);
  }, []);

  const load = async (): Promise<void> => {
    const result = await window.smp.replay.load(options);
    if (!result) return;
    if (!result.ok) {
      await alertDialog(t('replay.title'), t('replay.error', { error: result.error }), 'error');
      return;
    }
    const info = result.value;
    setLoaded(await window.smp.replay.list());
    await refreshPorts();
    // Ready to connect: the new device is selected in the monitor.
    if (appStore.get().connection === 'disconnected') updateSettings({ port: info.path });
    toast(t('replay.added', { name: info.name, path: info.path }), 'ok');
  };

  const configure = async (info: ReplayInfo, next: ReplayOptions): Promise<void> => {
    const updated = await window.smp.replay.configure(info.path, next);
    if (updated) setLoaded((all) => all.map((r) => (r.path === info.path ? updated : r)));
  };

  const remove = async (info: ReplayInfo): Promise<void> => {
    await window.smp.replay.remove(info.path);
    setLoaded(await window.smp.replay.list());
    await refreshPorts();
  };

  return (
    <Modal
      title={t('replay.title')}
      icon={History}
      onClose={onClose}
      testId="replay-dialog"
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>{t('common.close')}</Button>
        </>
      }
    >
      <p className="muted">{t('replay.intro')}</p>
      <div className="replay-load">
        <span className="toolbar-label">{t('replay.mode')}</span>
        <ReplayOptionsEditor value={options} onChange={setOptions} testId="replay-new" />
        <p className="muted small">
          {options.mode === 'answer' ? t('replay.modeAnswerTip') : t('replay.modeTimedTip')}
        </p>
        <Button
          variant="primary"
          icon={FolderOpen}
          onClick={() => void load()}
          data-testid="replay-load"
        >
          {t('replay.load')}
        </Button>
      </div>
      <h4>{t('replay.loaded')}</h4>
      {loaded.length === 0 ? (
        <p className="muted" data-testid="replay-none">
          {t('replay.none')}
        </p>
      ) : (
        <ul className="replay-list" data-testid="replay-list">
          {loaded.map((info) => (
            <li key={info.path} data-testid={`replay-item-${info.path}`}>
              <div className="replay-head">
                <b>{info.name}</b>
                <span className="mono muted">{info.path}</span>
                <span className="grow" />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => void remove(info)}
                  data-testid={`replay-remove-${info.path}`}
                >
                  {t('replay.remove')}
                </Button>
              </div>
              <div className="muted small">
                {t('replay.summary', {
                  duration: formatDuration(info.summary.durationMs),
                  rx: formatCount(info.summary.rxBytes),
                  tx: formatCount(info.summary.txBytes),
                })}
                {info.port && ` · ${t('replay.recorded', { baud: info.port.baudRate })}`}
              </div>
              <ReplayOptionsEditor
                value={info.options}
                onChange={(next) => void configure(info, next)}
                testId={`replay-opts-${info.path}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
