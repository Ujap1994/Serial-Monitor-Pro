// Application frame: connection bar, tab bar and status bar.

import type { ReactNode } from 'react';
import {
  Binary,
  Boxes,
  Cable,
  ChartSpline,
  ListChecks,
  Moon,
  OctagonX,
  Plug,
  RefreshCw,
  ScanSearch,
  Settings as SettingsIcon,
  ShieldCheck,
  SquareTerminal,
  Sun,
  TableProperties,
  Unplug,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { formatCount } from '@shared/i18n';
import { BAUD_RATES, DATA_BITS, PARITIES, STOP_BITS, type Parity } from '@shared/core/settings';
import logo from '../assets/logo.svg';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, setTab, TABS, updateSettings, type TabId } from '../state/app';
import { refreshPorts, toggleConnection } from '../state/serial';
import { openDialog } from '../state/ui';
import { Button, Input, Select } from './ui';

export const TAB_ICONS: Record<TabId, LucideIcon> = {
  monitor: SquareTerminal,
  presets: ListChecks,
  crc: ShieldCheck,
  stop: OctagonX,
  protocol: Binary,
  automation: Workflow,
  multiport: Cable,
  sendtable: TableProperties,
  frameparser: Boxes,
  graph: ChartSpline,
};

function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} kB/s`;
  return `${bytesPerSecond} B/s`;
}

export function ConnectionBar(): ReactNode {
  const t = useT();
  const settings = useStore(appStore, (s) => s.settings);
  const ports = useStore(appStore, (s) => s.ports);
  const connection = useStore(appStore, (s) => s.connection);
  const locked = connection !== 'disconnected';

  const portOptions = ports.length
    ? ports.map((p) => ({
        value: p.path,
        label: p.description ? `${p.path}  –  ${p.description}` : p.path,
      }))
    : [{ value: '', label: t('conn.noPorts') }];
  if (settings.port && !ports.some((p) => p.path === settings.port)) {
    portOptions.unshift({
      value: settings.port,
      label: `${settings.port}  –  ${t('conn.notPresent')}`,
    });
  }

  const stateLabel = {
    disconnected: t('conn.state.disconnected'),
    connecting: t('conn.state.connecting'),
    connected: t('conn.state.connected'),
    reconnecting: t('conn.state.reconnecting'),
  }[connection];

  return (
    <header className="connbar">
      <div className="brand">
        <img src={logo} alt="" draggable={false} />
        <div className="brand-name">
          Serial Monitor Pro
          <small>{t('app.tagline')}</small>
        </div>
      </div>

      <div className="conn-group">
        <label htmlFor="port">{t('conn.port')}</label>
        <Select
          id="port"
          data-testid="port-select"
          value={settings.port}
          options={portOptions}
          onChange={(port) => updateSettings({ port })}
          disabled={locked}
          style={{ width: 210 }}
        />
        <Button
          iconOnly
          icon={RefreshCw}
          onClick={() => void refreshPorts()}
          title={`${t('conn.refresh')} (F5)`}
          disabled={locked}
        >
          {t('conn.refresh')}
        </Button>
      </div>

      <div className="conn-group">
        <label htmlFor="baud">{t('conn.baud')}</label>
        <Input
          id="baud"
          data-testid="baud-input"
          list="baud-rates"
          mono
          inputMode="numeric"
          style={{ width: 96 }}
          defaultValue={settings.baud}
          key={settings.baud}
          disabled={locked}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 50) updateSettings({ baud: n });
            else e.target.value = String(settings.baud);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <datalist id="baud-rates">
          {BAUD_RATES.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </div>

      <div className="conn-group">
        <label htmlFor="databits">{t('conn.dataBits')}</label>
        <Select
          id="databits"
          value={settings.dataBits}
          options={DATA_BITS}
          onChange={(dataBits) => updateSettings({ dataBits })}
          disabled={locked}
          style={{ width: 58 }}
        />
        <label htmlFor="parity">{t('conn.parity')}</label>
        <Select<Parity>
          id="parity"
          value={settings.parity}
          options={PARITIES.map((p) => ({ value: p, label: t(`conn.parity.${p}`) }))}
          onChange={(parity) => updateSettings({ parity })}
          disabled={locked}
          style={{ width: 92 }}
        />
        <label htmlFor="stopbits">{t('conn.stopBits')}</label>
        <Select
          id="stopbits"
          value={settings.stopBits}
          options={STOP_BITS}
          onChange={(stopBits) => updateSettings({ stopBits })}
          disabled={locked}
          style={{ width: 62 }}
        />
      </div>

      <div className="conn-group">
        <Button
          data-testid="connect-button"
          variant={connection === 'disconnected' ? 'primary' : 'danger'}
          icon={connection === 'disconnected' ? Plug : Unplug}
          wide
          disabled={connection === 'connecting'}
          onClick={() => void toggleConnection()}
          title={`${connection === 'disconnected' ? t('conn.connect') : t('conn.disconnect')} (Ctrl+K)`}
        >
          {connection === 'disconnected'
            ? t('conn.connect')
            : connection === 'reconnecting'
              ? t('conn.cancel')
              : t('conn.disconnect')}
        </Button>
        <Button
          variant="violet"
          icon={ScanSearch}
          onClick={() => openDialog('baudscan')}
          disabled={locked}
          title={t('scan.tooltip')}
        >
          {t('scan.button')}
        </Button>
      </div>

      <span className="status-pill" data-state={connection} data-testid="connection-state">
        {stateLabel}
      </span>
    </header>
  );
}

export function TabBar(): ReactNode {
  const t = useT();
  const tab = useStore(appStore, (s) => s.tab);
  const busy = useStore(appStore, (s) => s.busyTabs);
  const dark = useStore(appStore, (s) => s.dark);
  return (
    <nav className="tabbar" role="tablist">
      {TABS.map((id, i) => {
        const Icon = TAB_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            className="tab"
            data-testid={`tab-${id}`}
            aria-selected={tab === id}
            title={i < 9 ? `Ctrl+${i + 1}` : 'Ctrl+0'}
            onClick={() => setTab(id)}
          >
            <Icon size={15} strokeWidth={2.2} aria-hidden />
            {t(`tab.${id}`)}
            {busy.includes(id) && <span className="tab-dot" aria-label={t('common.running')} />}
          </button>
        );
      })}
      <span className="grow" />
      <div className="tabbar-actions">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={dark ? Sun : Moon}
          title={dark ? t('settings.theme.light') : t('settings.theme.dark')}
          onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}
          data-testid="toggle-theme"
        >
          {t('menu.theme')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={SettingsIcon}
          title={`${t('menu.settings')} (Ctrl+,)`}
          data-testid="open-settings"
          onClick={() => openDialog('settings')}
        >
          {t('menu.settings')}
        </Button>
      </div>
    </nav>
  );
}

export function StatusBar(): ReactNode {
  const t = useT();
  const status = useStore(appStore, (s) => s.status);
  const rxBytes = useStore(appStore, (s) => s.rxBytes);
  const txBytes = useStore(appStore, (s) => s.txBytes);
  const rxRate = useStore(appStore, (s) => s.rxRate);
  const txRate = useStore(appStore, (s) => s.txRate);
  const info = useStore(appStore, (s) => s.info);
  const simulator = useStore(appStore, (s) => s.settings.simulator);
  return (
    <footer className="statusbar">
      <span className="message" data-tone={status.tone} data-testid="status-message">
        {status.text || t('status.ready')}
      </span>
      {simulator && <span className="sim">{t('status.simulator')}</span>}
      <div className="counters" data-testid="counters">
        <span className="rx">
          RX <b>{formatCount(rxBytes)}</b> B{rxRate > 0 && <i> · {formatRate(rxRate)}</i>}
        </span>
        <span className="tx">
          TX <b>{formatCount(txBytes)}</b> B{txRate > 0 && <i> · {formatRate(txRate)}</i>}
        </span>
      </div>
      <span>{info ? `v${info.version} · ${info.platform} ${info.arch}` : ''}</span>
    </footer>
  );
}
