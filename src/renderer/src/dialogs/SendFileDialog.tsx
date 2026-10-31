import { useMemo, useRef, useState, type ReactNode } from 'react';
import { FileUp, FolderOpen, SendHorizontal, Square } from 'lucide-react';
import { formatCount } from '@shared/i18n';
import {
  estimateSeconds,
  MAX_SEND_FILE_BYTES,
  splitForSending,
  type FileSendMode,
} from '@shared/core/filesend';
import type { BinaryFile } from '@shared/ipc';
import { Modal } from '../components/Modal';
import { Button, Field, NumberInput, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, updateSettings } from '../state/app';
import { sendFile } from '../state/serial';
import { alertDialog } from '../state/ui';

export function SendFileDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const cfg = useStore(appStore, (s) => s.settings.fileSend);
  const baud = useStore(appStore, (s) => s.settings.baud);
  const connected = useStore(appStore, (s) => s.connection === 'connected');
  const [file, setFile] = useState<BinaryFile | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const pieces = useMemo(
    () => (file ? splitForSending(file.data, cfg.mode, cfg.blockSize).length : 0),
    [file, cfg.mode, cfg.blockSize],
  );
  const set = (patch: Partial<typeof cfg>): void =>
    updateSettings({ fileSend: { ...cfg, ...patch } });

  const choose = async (): Promise<void> => {
    const result = await window.smp.files.openBinary(MAX_SEND_FILE_BYTES);
    if (!result) return;
    if (!result.ok) {
      await alertDialog(t('sendfile.readFailed'), result.error, 'error');
      return;
    }
    setFile(result.value);
    setProgress(null);
  };

  const start = async (): Promise<void> => {
    if (!file) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    await sendFile(file, cfg, (sent, total) => setProgress({ sent, total }), controller.signal);
    abort.current = null;
    setRunning(false);
  };

  const close = (): void => {
    abort.current?.abort();
    onClose();
  };

  const percent = progress && progress.total ? (100 * progress.sent) / progress.total : 0;

  return (
    <Modal
      title={t('sendfile.title')}
      icon={FileUp}
      onClose={close}
      testId="sendfile-dialog"
      footer={
        <>
          <span className="spacer" />
          <Button onClick={close}>{t('common.close')}</Button>
          {running ? (
            <Button
              variant="danger"
              icon={Square}
              onClick={() => abort.current?.abort()}
              data-testid="sendfile-cancel"
            >
              {t('common.cancel')}
            </Button>
          ) : (
            <Button
              variant="success"
              icon={SendHorizontal}
              disabled={!file || !connected || !file.data.length}
              title={connected ? undefined : t('error.notConnected')}
              onClick={() => void start()}
              data-testid="sendfile-start"
            >
              {t('sendfile.start')}
            </Button>
          )}
        </>
      }
    >
      <div className="row">
        <Button icon={FolderOpen} onClick={() => void choose()} disabled={running}>
          {t('sendfile.choose')}
        </Button>
        <span className="grow file-name" data-testid="sendfile-name">
          {file ? (
            <>
              <b>{file.name}</b>{' '}
              <span className="muted">
                {t('sendfile.bytes', { bytes: formatCount(file.data.length) })}
              </span>
            </>
          ) : (
            <span className="muted">{t('sendfile.none')}</span>
          )}
        </span>
      </div>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Field label={t('sendfile.mode')}>
          <Select<FileSendMode>
            value={cfg.mode}
            options={[
              { value: 'blocks', label: t('sendfile.mode.blocks') },
              { value: 'lines', label: t('sendfile.mode.lines') },
            ]}
            onChange={(mode) => set({ mode })}
            disabled={running}
            data-testid="sendfile-mode"
          />
        </Field>
        <Field label={t('sendfile.blockSize')}>
          <NumberInput
            value={cfg.blockSize}
            min={1}
            max={4096}
            onChange={(blockSize) => set({ blockSize })}
            disabled={running}
            data-testid="sendfile-block"
          />
        </Field>
        <Field label={t('sendfile.pause')}>
          <NumberInput
            value={cfg.pauseMs}
            min={0}
            max={60_000}
            onChange={(pauseMs) => set({ pauseMs })}
            disabled={running}
            data-testid="sendfile-pause"
          />
        </Field>
      </div>
      <p className="muted small">{t('sendfile.hint')}</p>
      {file && (
        <div className="muted small" data-testid="sendfile-estimate">
          {t('sendfile.estimate', {
            pieces: formatCount(pieces),
            seconds: estimateSeconds(file.data.length, pieces, baud, cfg.pauseMs).toFixed(1),
          })}
        </div>
      )}
      {progress && (
        <div className="progress" data-testid="sendfile-progress">
          <div className="progress-bar" style={{ width: `${percent}%` }} />
          <span>
            {t('sendfile.progress', {
              sent: formatCount(progress.sent),
              total: formatCount(progress.total),
            })}
          </span>
        </div>
      )}
    </Modal>
  );
}
