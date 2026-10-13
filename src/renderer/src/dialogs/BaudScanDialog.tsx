import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check as CheckIcon, ScanSearch } from 'lucide-react';
import { bestBaud, printableRatio, SCAN_BAUDS, type ScanResult } from '@shared/core/baudscan';
import { Modal } from '../components/Modal';
import { Button } from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, setStatus, updateSettings } from '../state/app';

const LISTEN_MS = 400;

export function BaudScanDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const port = useStore(appStore, (s) => s.settings.port);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [running, setRunning] = useState(true);
  const [done, setDone] = useState(false);
  // Cancels the scan that is currently running (if any).
  const cancelRef = useRef<() => void>(() => undefined);

  /** Listens on every baud rate. State is only touched after the first await. */
  const scan = async (cancelled: () => boolean): Promise<void> => {
    const collected: ScanResult[] = [];
    for (const baud of SCAN_BAUDS) {
      if (cancelled()) return;
      const result = await window.smp.serial.sample(port, baud, LISTEN_MS);
      if (cancelled()) return;
      const entry: ScanResult = result.ok
        ? {
            baud,
            bytes: result.value.length,
            ratio: result.value.length ? printableRatio(result.value) : null,
          }
        : { baud, bytes: 0, ratio: null, error: result.error };
      collected.push(entry);
      setResults([...collected]);
      if (!result.ok && result.code === 'in-use') break;
    }
    setRunning(false);
    setDone(true);
    const best = bestBaud(collected);
    if (best) {
      updateSettings({ baud: best.baud });
      setStatus(t('scan.found', { baud: best.baud }), 'ok');
    }
  };

  const start = (): void => {
    let stopped = false;
    cancelRef.current();
    cancelRef.current = () => {
      stopped = true;
    };
    void scan(() => stopped);
  };

  const restart = (): void => {
    setResults([]);
    setDone(false);
    setRunning(true);
    start();
  };

  // Start once when the dialog opens; closing it cancels the scan.
  useEffect(() => {
    const timer = setTimeout(start, 0);
    return () => {
      clearTimeout(timer);
      cancelRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const best = done ? bestBaud(results) : null;

  return (
    <Modal
      title={t('scan.title')}
      icon={ScanSearch}
      onClose={onClose}
      testId="baudscan-dialog"
      footer={
        <>
          <span className="muted">{port}</span>
          <span className="spacer" />
          {running ? (
            <Button
              onClick={() => {
                cancelRef.current();
                setRunning(false);
                setDone(true);
              }}
            >
              {t('common.cancel')}
            </Button>
          ) : (
            <Button onClick={restart}>{t('scan.again')}</Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {t('scan.description', { ms: LISTEN_MS })}
      </p>
      <div style={{ display: 'grid', gap: 6 }} data-testid="baudscan-results">
        {results.map((r) => (
          <div key={r.baud} className={best?.baud === r.baud ? 'scan-row best' : 'scan-row'}>
            <span>{r.baud}</span>
            <span className="scan-bar">
              <i style={{ width: `${Math.round((r.ratio ?? 0) * 100)}%` }} />
            </span>
            <span>
              {r.error
                ? t('scan.error')
                : r.ratio === null
                  ? t('scan.noData')
                  : `${Math.round(r.ratio * 100)} % · ${r.bytes} B`}
            </span>
          </div>
        ))}
      </div>
      {done &&
        (best ? (
          <div className="notice info" data-testid="baudscan-best">
            <CheckIcon size={14} />{' '}
            {t('scan.best', { baud: best.baud, ratio: Math.round((best.ratio ?? 0) * 100) })}
          </div>
        ) : (
          <div className="notice">
            {results.some((r) => r.error)
              ? (results.find((r) => r.error)?.error ?? '')
              : t('scan.none')}
          </div>
        ))}
    </Modal>
  );
}
