import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Eraser,
  FileUp,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Search,
  SendHorizontal,
  ShieldCheck,
  Square,
  SquareTerminal,
} from 'lucide-react';
import { NEWLINES, type Newline } from '@shared/core/commands';
import { DATA_FORMATS, formatHexInput, type DataFormat } from '@shared/core/format';
import { PERIODIC_MAX_MS, PERIODIC_MIN_MS } from '@shared/core/settings';
import { monitorPacket, monitorSendBytes, type TransmitCrcConfig } from '@shared/core/transmit-crc';
import { MonitorView } from '../components/LogView';
import { PacketPreview } from '../components/PacketPreview';
import { Button, Card, Check, Input, NumberInput, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, setTab, updateSettings } from '../state/app';
import { openDialog } from '../state/ui';
import {
  clearMonitor,
  monitor,
  renderOptions,
  sendCommand,
  sendText,
  setMonitorPaused,
  startFileLog,
  startPeriodic,
  stopFileLog,
  stopPeriodic,
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
            <span className="fmt">
              {c.sequence ? `SEQ ${c.steps.length}` : c.fmt}
              {c.addCrc && ' +CRC'}
            </span>
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
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={s.quickPanel ? PanelLeftClose : PanelLeftOpen}
        title={s.quickPanel ? t('quick.hide') : t('quick.show')}
        onClick={() => updateSettings({ quickPanel: !s.quickPanel })}
        data-testid="toggle-quick"
      >
        {t('quick.title')}
      </Button>
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
      <div className="opts-end">
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
    </div>
  );
}

function SendBar(): ReactNode {
  const t = useT();
  const s = useStore(appStore, (st) => st.settings);
  const connected = useStore(appStore, (st) => st.connection === 'connected');
  const periodic = useStore(appStore, (st) => st.periodic !== null);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const historyPos = useRef(-1);
  const crc = s.transmitCrc;
  const setCrc = (patch: Partial<TransmitCrcConfig>): void =>
    updateSettings({ transmitCrc: { ...crc, ...patch } });
  // Periodic sending reads the input before every send (like the Python version).
  const latest = useRef({ text, fmt: s.sendFormat, newline: s.newline });
  useEffect(() => {
    latest.current = { text, fmt: s.sendFormat, newline: s.newline };
  }, [text, s.sendFormat, s.newline]);

  const framed = crc.enabled || crc.useHeader || crc.useFooter;
  const preview = useMemo(() => {
    try {
      return { packet: monitorPacket(text, s.sendFormat, s.newline, crc), error: '' };
    } catch (err) {
      return { packet: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [text, s.sendFormat, s.newline, crc]);

  const hexOptions = { uppercase: s.hexUppercase, group: s.hexGroup, groupSize: s.hexGroupSize };
  const hexField = (value: string): string =>
    s.sendFormat === 'HEX' ? formatHexInput(value, -1, hexOptions).text : value;

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
    if (s.clearAfterSend && !periodic) setText('');
    else input.current?.select();
  };

  return (
    <div className="sendarea" data-testid="sendarea">
      <div className="sendarea-row">
        <span className="send-group">
          <span className="toolbar-label">{t('monitor.send')}</span>
          <Select<DataFormat>
            value={s.sendFormat}
            options={DATA_FORMATS}
            data-testid="send-format"
            title={t('command.format')}
            style={{ width: 86 }}
            onChange={(sendFormat) => {
              updateSettings({ sendFormat });
              if (sendFormat === 'HEX' && text.trim())
                setText(formatHexInput(text, -1, hexOptions).text);
            }}
          />
          <Select<Newline>
            value={s.newline}
            options={NEWLINES.map((n) => ({ value: n, label: t(`newline.${n}`) }))}
            onChange={(newline) => updateSettings({ newline })}
            title={t('monitor.newline')}
            aria-label={t('monitor.newline')}
            data-testid="send-newline"
            style={{ width: 104 }}
          />
        </span>
        <span className="send-group">
          <Check
            checked={crc.enabled}
            onChange={(enabled) => setCrc({ enabled })}
            title={t('crc.addTip')}
            testId="monitor-crc-auto"
          >
            {t('crc.add')}
          </Check>
          <Check
            checked={crc.useHeader}
            onChange={(useHeader) => setCrc({ useHeader })}
            title={t('crc.useHeaderTip')}
            testId="monitor-use-header"
          >
            {t('crc.header')}
          </Check>
          <Check
            checked={crc.useFooter}
            onChange={(useFooter) => setCrc({ useFooter })}
            title={t('crc.useFooterTip')}
            testId="monitor-use-footer"
          >
            {t('crc.footer')}
          </Check>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={ShieldCheck}
            title={t('crc.settings')}
            onClick={() => setTab('crc')}
            data-testid="monitor-crc-settings"
          >
            {t('crc.settings')}
          </Button>
        </span>
        <span className="send-group send-group-end">
          <span className="toolbar-label muted" title={t('periodic.tip')}>
            {t('periodic.label')}
          </span>
          <NumberInput
            value={s.periodicMs}
            min={PERIODIC_MIN_MS}
            max={PERIODIC_MAX_MS}
            onChange={(periodicMs) => updateSettings({ periodicMs })}
            title={t('periodic.tip')}
            data-testid="periodic-ms"
            style={{ width: 92 }}
          />
          <Button
            size="sm"
            variant={periodic ? 'danger' : 'default'}
            icon={periodic ? Square : Repeat}
            data-testid="periodic-toggle"
            title={t('periodic.tip')}
            onClick={() => {
              if (periodic) stopPeriodic();
              else
                void startPeriodic({
                  label: t('monitor.inputLabel'),
                  next: () => {
                    const { text, fmt, newline } = latest.current;
                    const crcConfig = appStore.get().settings.transmitCrc;
                    const data = monitorSendBytes(text, fmt, newline, crcConfig);
                    return { parts: [{ data, pauseMs: 0 }], fmt };
                  },
                  intervalMs: () => appStore.get().settings.periodicMs,
                });
            }}
          >
            {periodic ? t('periodic.stopShort') : t('periodic.startShort')}
          </Button>
        </span>
      </div>
      <div className="sendarea-row">
        <Input
          mono
          className="framing-input"
          value={crc.header}
          placeholder={t('crc.header')}
          title={t('crc.useHeaderTip')}
          disabled={!crc.useHeader}
          onChange={(e) => setCrc({ header: hexField(e.target.value) })}
          data-testid="monitor-header"
        />
        <Input
          ref={input}
          mono
          className="send-input"
          data-testid="send-input"
          value={text}
          placeholder={
            connected ? t('monitor.sendPlaceholder') : t('monitor.sendPlaceholderOffline')
          }
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
        <Input
          mono
          className="framing-input"
          value={crc.footer}
          placeholder={t('crc.footer')}
          title={t('crc.useFooterTip')}
          disabled={!crc.useFooter}
          onChange={(e) => setCrc({ footer: hexField(e.target.value) })}
          data-testid="monitor-footer"
        />
        <Button
          variant="success"
          icon={SendHorizontal}
          onClick={() => void send()}
          data-testid="send-button"
          disabled={Boolean(preview.error)}
        >
          {t('monitor.sendButton')}
        </Button>
        <Button
          icon={FileUp}
          onClick={() => openDialog('sendfile')}
          title={t('monitor.sendFileTip')}
          data-testid="send-file"
        >
          {t('monitor.sendFile')}
        </Button>
      </div>
      {framed && (
        <div className={preview.error ? 'notice' : 'send-preview'} data-testid="send-preview">
          {preview.error ? (
            preview.error
          ) : (
            <>
              <span className="muted">{t('crc.wirePreview')}:</span>{' '}
              {preview.packet ? (
                <PacketPreview packet={preview.packet} />
              ) : (
                <span className="muted">—</span>
              )}
              {crc.enabled && (
                <span className="muted send-preview-meta">
                  {crc.algorithm} · {crc.bigEndian ? 'BE' : 'LE'} · {t('crc.position')}{' '}
                  {crc.position}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MonitorPage(): ReactNode {
  const t = useT();
  const s = useStore(appStore, (st) => st.settings);
  const paused = useStore(appStore, (st) => st.monitorPaused);
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
        {paused && (
          <div className="notice row" data-testid="monitor-paused">
            <span className="grow">{t('monitor.pausedBanner')}</span>
            <Button size="sm" onClick={() => setMonitorPaused(false)}>
              {t('stop.resume')}
            </Button>
          </div>
        )}
        <DisplayOptions
          shown={stats.shown}
          total={stats.total}
          filter={filter}
          setFilter={setFilter}
        />
        <SendBar />
      </div>
    </div>
  );
}
