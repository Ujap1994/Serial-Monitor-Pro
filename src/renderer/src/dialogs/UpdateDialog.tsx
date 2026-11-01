import type { ReactNode } from 'react';
import { CircleCheck, Download, TriangleAlert } from 'lucide-react';
import { releaseChanges } from '@shared/core/updates';
import { Markdown } from '../components/Markdown';
import { Modal } from '../components/Modal';
import { Button, Check } from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, updateSettings } from '../state/app';
import { latestVersion } from '../state/updates';

export function UpdateDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const info = useStore(appStore, (s) => s.info);
  const update = useStore(appStore, (s) => s.update);
  const language = useStore(appStore, (s) => s.language);
  const repo = info?.repository ?? '';
  const current = info?.version ?? '';
  const newer = update?.newer ?? [];
  const latest = latestVersion();
  const skipped = useStore(appStore, (s) => s.settings.updateSkipped);
  const error = update?.error ?? null;
  const open = (path: string) => () => void window.smp.app.openExternal(`${repo}${path}`);
  const date = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(language === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'long' });
  };

  return (
    <Modal
      title={newer.length ? t('update.title') : t('update.titleNone')}
      icon={error ? TriangleAlert : newer.length ? Download : CircleCheck}
      tone={error ? 'warn' : newer.length ? 'info' : 'ok'}
      wide={newer.length > 0}
      onClose={onClose}
      testId="update-dialog"
      footer={
        newer.length ? (
          <>
            <Check
              checked={skipped === latest}
              onChange={(skip) => updateSettings({ updateSkipped: skip ? latest : '' })}
              testId="update-skip"
            >
              {t('update.skip', { version: latest })}
            </Check>
            <span className="spacer" />
            <Button onClick={onClose}>{t('update.later')}</Button>
            <Button variant="primary" icon={Download} onClick={open('/releases/latest')}>
              {t('update.download')}
            </Button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <Button variant="primary" onClick={onClose}>
              {t('common.close')}
            </Button>
          </>
        )
      }
    >
      {error && <p className="modal-text">{t('update.failed', { error })}</p>}
      {!error && !newer.length && <p className="modal-text">{t('update.upToDate', { current })}</p>}
      {newer.length > 0 && (
        <>
          <p className="modal-text" data-testid="update-summary">
            <b>{t('update.available', { latest, current })}</b>
          </p>
          <div className="section-title">{t('update.changes', { current })}</div>
          <div className="release-notes" data-testid="update-changes">
            {newer.map((release) => (
              <section key={release.tag} className="release">
                <h4>
                  {release.name}
                  <span className="muted">
                    {' '}
                    · {t('update.released', { date: date(release.date) })}
                  </span>
                </h4>
                <Markdown source={releaseChanges(release.body)} />
              </section>
            ))}
          </div>
          <a
            className="release-link"
            href={`${repo}/releases`}
            onClick={(e) => (e.preventDefault(), open('/releases')())}
          >
            {repo.replace(/^https:\/\//, '')}/releases
          </a>
          <p className="muted small" data-testid="update-auto-hint">
            {t('update.autoHint')}
          </p>
        </>
      )}
    </Modal>
  );
}
