import type { ReactNode } from 'react';
import { BookOpen, Bug, ExternalLink, Info, Scale } from 'lucide-react';
import logo from '../assets/logo.svg';
import { Modal } from '../components/Modal';
import { Button } from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore } from '../state/app';

export function AboutDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const info = useStore(appStore, (s) => s.info);
  const repo = info?.repository ?? '';
  const open = (path: string) => () => void window.smp.app.openExternal(`${repo}${path}`);

  return (
    <Modal
      title={t('about.title')}
      icon={Info}
      onClose={onClose}
      testId="about-dialog"
      footer={
        <>
          <Button size="sm" icon={BookOpen} onClick={open('#readme')}>
            {t('menu.docs')}
          </Button>
          <Button size="sm" icon={Bug} onClick={open('/issues/new/choose')}>
            {t('menu.issue')}
          </Button>
          <Button size="sm" icon={Scale} onClick={open('/blob/main/LICENSE')}>
            {t('about.license')}
          </Button>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="about-head">
        <img src={logo} alt="" />
        <div>
          <h3>Serial Monitor Pro</h3>
          <div className="muted">
            {t('about.version', { version: info?.version ?? '' })} · {t('about.openSource')}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            © 2025–2026 PW SoHa-Solutions ·{' '}
            <a href={repo} onClick={(e) => (e.preventDefault(), open('')())}>
              GitHub <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>
      <p className="modal-text" style={{ margin: 0 }}>
        {t('about.text')}
      </p>
      <div className="disclaimer" data-testid="disclaimer">
        <b>{t('about.disclaimerTitle')}</b>
        <br />
        {t('about.disclaimer')}
      </div>
      {info && (
        <div className="code-block">
          Electron {info.electron} · Chromium {info.chrome} · Node.js {info.node}
          <br />
          {info.platform} {info.arch}
        </div>
      )}
    </Modal>
  );
}
