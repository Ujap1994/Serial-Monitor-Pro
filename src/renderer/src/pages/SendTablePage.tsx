import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Play, SendHorizontal, Square, TableProperties } from 'lucide-react';
import type { Command } from '@shared/core/commands';
import { Button, Card, Check, Empty, PageHeader } from '../components/ui';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { useStore } from '../lib/store';
import { appStore, setBusy, setCommands } from '../state/app';
import { isConnected, sendCommand } from '../state/serial';
import { alertDialog } from '../state/ui';

export function SendTablePage(): ReactNode {
  const t = useT();
  const commands = useStore(appStore, (s) => s.commands);
  const connected = useStore(appStore, (s) => s.connection === 'connected');
  const [selected, setSelected] = useState(-1);
  const [loop, setLoop] = useState(false);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [status, setStatus] = useState(t('common.ready'));
  const run = useRef<{
    active: boolean;
    index: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({
    active: false,
    index: 0,
    timer: null,
  });
  const loopRef = useLatest(loop);

  const stop = (reason: string): void => {
    run.current.active = false;
    if (run.current.timer) clearTimeout(run.current.timer);
    run.current.timer = null;
    setRunning(false);
    setCurrent(-1);
    setStatus(reason);
    setBusy('sendtable', false);
  };

  // A sequence stops when the connection drops.
  useEffect(() => {
    if (!connected && run.current.active) stop(t('sendtable.stopped.disconnected'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // Stop timers when the page goes away (window closing).
  useEffect(
    () => () => {
      if (run.current.timer) clearTimeout(run.current.timer);
    },
    [],
  );

  /**
   * Sends the next command. Uses a timer instead of a waiting loop, so the
   * interface stays responsive and "Stop" takes effect immediately.
   */
  const step = async (): Promise<void> => {
    if (!run.current.active) return;
    if (!isConnected()) return stop(t('sendtable.stopped.disconnected'));
    const active = appStore
      .get()
      .commands.map((c, i) => [i, c] as const)
      .filter(([, c]) => c.enabled);
    if (!active.length) return stop(t('sendtable.stopped.noneActive'));
    if (run.current.index >= active.length) {
      if (!loopRef.current) return stop(t('sendtable.stopped.done'));
      run.current.index = 0;
    }
    const [row, cmd] = active[run.current.index] as readonly [number, Command];
    setCurrent(row);
    setStatus(
      t('sendtable.sending', { n: run.current.index + 1, total: active.length, name: cmd.name }),
    );
    const ok = await sendCommand(cmd, true);
    if (!run.current.active) return;
    if (!ok) return stop(t('sendtable.stopped.failed'));
    run.current.index++;
    run.current.timer = setTimeout(() => void step(), Math.max(10, cmd.delayMs));
  };

  const start = async (): Promise<void> => {
    if (!commands.some((c) => c.enabled)) {
      await alertDialog(t('sendtable.nothingTitle'), t('sendtable.nothing'));
      return;
    }
    if (!isConnected()) {
      await alertDialog(t('error.notConnectedTitle'), t('error.notConnected'), 'warn');
      return;
    }
    run.current = { active: true, index: 0, timer: null };
    setRunning(true);
    setBusy('sendtable', true);
    void step();
  };

  const toggleEnabled = (i: number, enabled: boolean): void => {
    setCommands(commands.map((c, j) => (j === i ? { ...c, enabled } : c)));
  };

  return (
    <>
      <PageHeader title={t('sendtable.title')} description={t('sendtable.description')} />
      <Card fill>
        <div className="table-wrap" data-testid="send-table">
          {commands.length === 0 ? (
            <Empty icon={TableProperties}>{t('sendtable.empty')}</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('sendtable.active')}</th>
                  <th>#</th>
                  <th>{t('command.name')}</th>
                  <th>{t('command.format')}</th>
                  <th>{t('command.data')}</th>
                  <th>{t('command.newline')}</th>
                  <th>{t('sendtable.pause')}</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((c, i) => (
                  <tr
                    key={i}
                    aria-selected={i === selected}
                    className={i === current ? 'running' : undefined}
                    onClick={() => setSelected(i)}
                    onDoubleClick={() => void sendCommand(c)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <Check checked={c.enabled} onChange={(on) => toggleEnabled(i, on)}>
                        <span className="sr-only">{t('sendtable.active')}</span>
                      </Check>
                    </td>
                    <td className="muted">{i + 1}</td>
                    <td>{c.name}</td>
                    <td>
                      <span className="badge">{c.fmt}</span>
                    </td>
                    <td className="data">{c.data}</td>
                    <td>{t(`newline.${c.newline}`)}</td>
                    <td className="mono">{c.delayMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="row">
          <Button
            variant={running ? 'danger' : 'success'}
            icon={running ? Square : Play}
            wide
            data-testid="sendtable-run"
            onClick={() => (running ? stop(t('sendtable.stopped.manual')) : void start())}
          >
            {running ? t('sendtable.stop') : t('sendtable.start')}
          </Button>
          <Check checked={loop} onChange={setLoop} title={t('sendtable.loopTip')}>
            {t('common.repeat')}
          </Check>
          <Button
            icon={SendHorizontal}
            onClick={() => {
              const cmd = commands[selected];
              if (cmd) void sendCommand(cmd);
              else void alertDialog(t('presets.noSelectionTitle'), t('sendtable.noRow'));
            }}
          >
            {t('sendtable.sendSelected')}
          </Button>
          <span className="spacer" />
          <span className="muted" data-testid="sendtable-status">
            {status}
          </span>
        </div>
        <div className="field-hint">{t('sendtable.hint')}</div>
      </Card>
    </>
  );
}
