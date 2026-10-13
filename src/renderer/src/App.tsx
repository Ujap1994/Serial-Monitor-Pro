import { useEffect, type ReactNode } from 'react';
import { ModalHost, Toasts } from './components/Modal';
import { ConnectionBar, StatusBar, TabBar } from './components/Shell';
import { AboutDialog } from './dialogs/AboutDialog';
import { BaudScanDialog } from './dialogs/BaudScanDialog';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';
import { useStore } from './lib/store';
import { AutomationPage } from './pages/AutomationPage';
import { CrcPage } from './pages/CrcPage';
import { FrameParserPage } from './pages/FrameParserPage';
import { GraphPage } from './pages/GraphPage';
import { filterInputId, MonitorPage } from './pages/MonitorPage';
import { MultiPortPage } from './pages/MultiPortPage';
import { PresetsPage } from './pages/PresetsPage';
import { ProtocolPage } from './pages/ProtocolPage';
import { SendTablePage } from './pages/SendTablePage';
import { StopPage } from './pages/StopPage';
import { appStore, setTab, TABS, updateSettings, type TabId } from './state/app';
import { exportCommands, importCommands } from './state/commands';
import { exportCsv, exportText } from './state/export';
import { clearMonitor, refreshPorts, toggleConnection } from './state/serial';
import { openDialog, uiStore } from './state/ui';

const PAGES: Record<TabId, () => ReactNode> = {
  monitor: MonitorPage,
  presets: PresetsPage,
  crc: CrcPage,
  stop: StopPage,
  protocol: ProtocolPage,
  automation: AutomationPage,
  multiport: MultiPortPage,
  sendtable: SendTablePage,
  frameparser: FrameParserPage,
  graph: GraphPage,
};

function runMenuAction(action: string): void {
  switch (action) {
    case 'export-txt':
      return void exportText();
    case 'export-csv':
      return void exportCsv();
    case 'import-commands':
      return void importCommands();
    case 'export-commands':
      return void exportCommands();
    case 'settings':
      return openDialog('settings');
    case 'about':
      return openDialog('about');
    case 'shortcuts':
      return openDialog('shortcuts');
    case 'clear':
      return clearMonitor();
    case 'toggle-connection':
      return void toggleConnection();
    case 'refresh-ports':
      if (appStore.get().connection === 'disconnected') void refreshPorts();
      return;
    case 'baud-scan':
      if (appStore.get().connection === 'disconnected') openDialog('baudscan');
      return;
    default:
      if (action.startsWith('theme:')) {
        const theme = action.slice(6);
        if (theme === 'system' || theme === 'light' || theme === 'dark') updateSettings({ theme });
      }
  }
}

function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (uiStore.get().modals.length || uiStore.get().dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setTab('monitor');
        requestAnimationFrame(() => document.getElementById(filterInputId)?.focus());
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && /^[0-9]$/.test(e.key)) {
        const index = e.key === '0' ? 9 : Number(e.key) - 1;
        const tab = TABS[index];
        if (tab) {
          e.preventDefault();
          setTab(tab);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function GlobalDialogs(): ReactNode {
  const dialog = useStore(uiStore, (s) => s.dialog);
  const close = (): void => openDialog(null);
  switch (dialog) {
    case 'settings':
      return <SettingsDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'baudscan':
      return <BaudScanDialog onClose={close} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />;
    case null:
      return null;
  }
}

export function App(): ReactNode {
  const tab = useStore(appStore, (s) => s.tab);
  useKeyboard();
  useEffect(() => window.smp.app.onMenu(runMenuAction), []);

  return (
    <div className="app">
      <ConnectionBar />
      <TabBar />
      <main className="pages">
        {TABS.map((id) => {
          const Page = PAGES[id];
          // All pages stay mounted: running sequences, decoders and graphs keep
          // working while another tab is shown.
          return (
            <section key={id} className="page" hidden={tab !== id} data-testid={`page-${id}`}>
              <Page />
            </section>
          );
        })}
      </main>
      <StatusBar />
      <GlobalDialogs />
      <ModalHost />
      <Toasts />
    </div>
  );
}
