import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Eraser,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SendHorizontal,
  SquareTerminal,
} from 'lucide-react';
import { NEWLINES, type Newline } from '@shared/core/commands';
import { DATA_FORMATS, formatHexInput, type DataFormat } from '@shared/core/format';
import { MonitorView } from '../components/LogView';
import { Button, Card, Check, Input, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, setTab, updateSettings } from '../state/app';
import {
  clearMonitor,
  monitor,
  renderOptions,
  sendCommand,
  sendText,
  startFileLog,
  stopFileLog,
} from '../state/serial';

/** Focus target for Ctrl+F. */
export const filterInputId = 'monitor-filter';

function QuickPanel(): ReactNode {
  const t = useT();
  const commands = useStore(appStore, (s) => s.commands);
  return (
    <Card title={t('quick.title')} icon={ListChecks} fill className="quick">
      <div className="quick-list" data-testid="quick-list">
        {commands.length === 0 && <div className="quick-hint">{t('quick.empty')}</div>}
        {commands.map((c, i) => (
          <button
            key={i}
            type="button"
            className="quick-item"
            title={`${c.data} (${c.fmt})`}
            onClick={() => void sendCommand(c)}
          >
            <SendHorizontal size={13} strokeWidth={2.2} aria-hidden />
            <span className="name">{c.name}</span>
            <span className="fmt">{c.fmt}</span>
          </button>
        ))}
      </div>
      <div className="quick-hint">
        {t('quick.hint')}{' '}
        <a
          href="#presets"
          onClick={(e) => {
            e.preventDefault();
            setTab('presets');
          }}
        >
          {t('tab.presets')}
        </a>
      </div>
    </Card>
  );
}

interface DisplayOptionsProps {
  shown: number;
  total: number;
  filter: string;
  setFilter: (filter: string) => void;
}

function DisplayOptions({ shown, total, filter, setFilter }: DisplayOptionsProps): ReactNode {
  const t = useT();
  const s = useStore(appStore, (st) => st.settings);
  const [logging, setLogging] = useState(false);

  return (
    <div className="opts">
      <span className="toolbar-label">{t('monitor.display')}</span>
      <Select<DataFormat>
        value={s.display}
        options={DATA_FORMATS}
        onChange={(display) => updateSettings({ display })}
        data-testid="display-format"
        style={{ width: 86 }}
      />
      <Check checked={s.timestamp} onChange={(timestamp) => updateSettings({ timestamp })}>
        {t('monitor.timestamp')}
      </Check>
      <Check
        checked={s.deltaTime}
        onChange={(deltaTime) => updateSettings({ deltaTime })}
        title={t('monitor.deltaTip')}
      >
        Δt
      </Check>
      <Check checked={s.autoscroll} onChange={(autoscroll) => updateSettings({ autoscroll })}>
        {t('monitor.autoscroll')}
      </Check>
      <Check
        checked={s.utf8}
        onChange={(utf8) => updateSettings({ utf8 })}
        title={t('monitor.utf8Tip')}
      >
        UTF-8
      </Check>
      <Check
        checked={s.showCrlf}
        onChange={(showCrlf) => updateSettings({ showCrlf })}
        title={t('monitor.crlfTip')}
      >
        \r\n
      </Check>
      <Check
        checked={s.hexdump}
        onChange={(hexdump) => updateSettings({ hexdump })}
        title={t('monitor.hexdumpTip')}
        testId="hexdump-toggle"
      >
        {t('monitor.hexdump')}
      </Check>
      <Check
        checked={logging}
        title={t('monitor.fileLogTip')}
        onChange={(on) => {
          void (async () => {
            if (on) setLogging(await startFileLog());
            else {
              await stopFileLog();
              setLogging(false);
            }
          })();
        }}
      >
        {t('monitor.fileLog')}
      </Check>
      <span className="grow" />
      <div className="filter">
        <Search size={14} strokeWidth={2.4} aria-hidden />
        <Input
          id={filterInputId}
          data-testid="monitor-filter"
          placeholder={t('monitor.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
        />
      </div>
      {filter && (
        <span className="filter-count" data-testid="filter-count">
          {t('monitor.filterCount', { shown, total })}
        </span>
      )}
      <Button
        size="sm"
        icon={Eraser}
        onClick={clearMonitor}
        title={`${t('monitor.clear')} (Ctrl+L)`}
      >
        {t('monitor.clear')}
      </Button>
    </div>
  );
}

function SendBar(): ReactNode {
  const t = useT();
  const s = useStore(appStore, (st) => st.settings);
  const connected = useStore(appStore, (st) => st.connection === 'connected');
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const historyPos = useRef(-1);

  const hexOptions = { uppercase: s.hexUppercase, group: s.hexGroup, groupSize: s.hexGroupSize };

  const applyHex = (value: string, caret: number): void => {
    const out = formatHexInput(value, caret, hexOptions);
    setText(out.text);
    requestAnimationFrame(() => input.current?.setSelectionRange(out.cursor, out.cursor));
  };

  const send = async (): Promise<void> => {
    const ok = await sendText(text, s.sendFormat, s.newline);
    if (!ok) return;
    if (text.trim() && s.sendHistory && history.current[history.current.length - 1] !== text) {
      history.current.push(text);
      history.current.splice(0, history.current.length - 50);
    }
    historyPos.current = -1;
    if (s.clearAfterSend) setText('');
    else input.current?.select();
  };

  return (
    <div className="sendbar">
      <span className="toolbar-label">{t('monitor.send')}</span>
      <Select<DataFormat>
        value={s.sendFormat}
        options={DATA_FORMATS}
        data-testid="send-format"
        style={{ width: 86 }}
        onChange={(sendFormat) => {
          updateSettings({ sendFormat });
          if (sendFormat === 'HEX' && text.trim())
            setText(formatHexInput(text, -1, hexOptions).text);
        }}
      />
      <Input
        ref={input}
        mono
        data-testid="send-input"
        value={text}
        placeholder={connected ? t('monitor.sendPlaceholder') : t('monitor.sendPlaceholderOffline')}
        onChange={(e) => {
          if (s.sendFormat === 'HEX') applyHex(e.target.value, e.target.selectionStart ?? -1);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void send();
          } else if (
            s.sendHistory &&
            history.current.length &&
            (e.key === 'ArrowUp' || e.key === 'ArrowDown')
          ) {
            e.preventDefault();
            const h = history.current;
            if (e.key === 'ArrowUp') {
              historyPos.current = Math.min(historyPos.current + 1, h.length - 1);
            } else {
              historyPos.current = Math.max(historyPos.current - 1, -1);
            }
            setText(historyPos.current < 0 ? '' : (h[h.length - 1 - historyPos.current] ?? ''));
          }
        }}
      />
      <span className="toolbar-label muted">{t('monitor.newline')}</span>
      <Select<Newline>
        value={s.newline}
        options={NEWLINES.map((n) => ({ value: n, label: t(`newline.${n}`) }))}
        onChange={(newline) => updateSettings({ newline })}
        style={{ width: 104 }}
      />
      <Button
        variant="success"
        icon={SendHorizontal}
        onClick={() => void send()}
        data-testid="send-button"
      >
        {t('monitor.sendButton')}
      </Button>
    </div>
  );
}

export function MonitorPage(): ReactNode {
  const t = useT();
  const s = useStore(appStore, (st) => st.settings);
  const [filter, setFilter] = useState('');
  const [stats, setStats] = useState({ shown: 0, total: 0 });

  const options = useMemo(
    () => renderOptions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderOptions reads exactly these settings
    [s.display, s.utf8, s.showCrlf, s.hexdump, s.timestamp, s.timestampFormat, s.deltaTime],
  );

  return (
    <div className={s.quickPanel ? 'monitor' : 'monitor no-panel'}>
      {s.quickPanel && <QuickPanel />}
      <div className="monitor-main">
        <MonitorView
          model={monitor}
          options={options}
          filter={filter}
          autoscroll={s.autoscroll}
          emptyIcon={SquareTerminal}
          empty={
            <>
              <b>{t('monitor.emptyTitle')}</b>
              <br />
              {t('monitor.emptyText')}
            </>
          }
          onStats={(shown, total) =>
            setStats((prev) =>
              prev.shown === shown && prev.total === total ? prev : { shown, total },
            )
          }
        />
        <DisplayOptions
          shown={stats.shown}
          total={stats.total}
          filter={filter}
          setFilter={setFilter}
        />
        <div className="row nowrap">
          <Button
            variant="ghost"
            iconOnly
            icon={s.quickPanel ? PanelLeftClose : PanelLeftOpen}
            title={s.quickPanel ? t('quick.hide') : t('quick.show')}
            onClick={() => updateSettings({ quickPanel: !s.quickPanel })}
          >
            {t('quick.title')}
          </Button>
          <div className="grow">
            <SendBar />
          </div>
        </div>
      </div>
    </div>
  );
}
