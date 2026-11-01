import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Binary, Download, Eraser, Languages, Lightbulb, ScrollText } from 'lucide-react';
import { decodeLatin1, toHexString } from '@shared/core/bytes';
import { InputError, parseSendData } from '@shared/core/format';
import {
  decodeModbusAscii,
  decodeModbusRtu,
  isModbusAsciiValid,
  isModbusRtuValid,
} from '@shared/core/modbus';
import { decodeNmea, isNmeaValid } from '@shared/core/nmea';
import { fileStamp, formatTimestamp } from '@shared/core/timestamp';
import { Button, Card, Check, Empty, Input, PageHeader, Select } from '../components/ui';
import { useHexChange } from '../components/useHexChange';
import { useT } from '../lib/i18n';
import { setBusy, setStatus } from '../state/app';
import { rxBus } from '../state/serial';
import { alertDialog, toast } from '../state/ui';

type Protocol = 'modbus' | 'modbus-ascii' | 'nmea';

const EXAMPLES: Record<Protocol, string> = {
  modbus: '01 03 00 00 00 0A C5 CD',
  'modbus-ascii': ':01030000000AF2',
  nmea: '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47',
};

const PROTOCOL_NAMES: Record<Protocol, string> = {
  modbus: 'Modbus RTU',
  'modbus-ascii': 'Modbus ASCII',
  nmea: 'NMEA 0183',
};

/** Modbus RTU frames are separated by a pause of at least 3.5 characters. */
const MODBUS_GAP_MS = 20;
/** Decoded packets kept for the export. */
const MAX_PACKETS = 10_000;

interface Packet {
  id: number;
  t: number;
  protocol: Protocol;
  raw: string;
  text: string;
  valid: boolean;
  /** Length in bytes (Modbus RTU) or characters (line protocols). */
  size: number;
}

/** Packets shown in the list – older ones stay available for the export. */
const MAX_SHOWN = 1000;

/** Raw bytes as rows of 16 with their offset, for the details. */
function hexRows(raw: string): string[] {
  const bytes = raw.split(' ');
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 16)
    rows.push(
      `${i.toString(16).toUpperCase().padStart(4, '0')}  ${bytes.slice(i, i + 16).join(' ')}`,
    );
  return rows;
}

function PacketDetails({ packet }: { packet: Packet | undefined }): ReactNode {
  const t = useT();
  if (!packet) return <Empty icon={Binary}>{t('protocol.selectPacket')}</Empty>;
  const fields = packet.text.split('  |  ');
  return (
    <div className="packet-details selectable" data-testid="protocol-details">
      <div className="row">
        <b>{PROTOCOL_NAMES[packet.protocol]}</b>
        <span className={packet.valid ? 'badge badge-ok' : 'badge badge-bad'}>
          {packet.valid ? t('protocol.validPacket') : t('protocol.invalidPacket')}
        </span>
        <span className="spacer" />
        <span className="muted mono small">{formatTimestamp(packet.t, 'time-ms')}</span>
      </div>
      <div className="section-title">{t('protocol.fields')}</div>
      <ul className="field-list">
        {fields.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
      <div className="section-title">
        {t('protocol.rawCol')} ·{' '}
        {packet.protocol === 'modbus'
          ? t('protocol.bytes', { count: packet.size })
          : t('protocol.chars', { count: packet.size })}
      </div>
      <pre className="code-block mono">
        {packet.protocol === 'modbus' ? hexRows(packet.raw).join('\n') : packet.raw}
      </pre>
    </div>
  );
}

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function ProtocolPage(): ReactNode {
  const t = useT();
  const [protocol, setProtocol] = useState<Protocol>('modbus');
  const [live, setLive] = useState(false);
  const [showInvalid, setShowInvalid] = useState(true);
  const [test, setTest] = useState('');
  const hex = useHexChange();
  const [counts, setCounts] = useState({ total: 0, valid: 0 });
  const [shown, setShown] = useState<Packet[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [inputError, setInputError] = useState('');
  const packets = useRef<Packet[]>([]);
  const nextId = useRef(1);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  /** Counts and keeps one decoded packet; the list is refreshed at most 5× per second. */
  const add = (p: Omit<Packet, 't' | 'id'>): void => {
    packets.current.push({ ...p, t: Date.now(), id: nextId.current++ });
    if (packets.current.length > MAX_PACKETS) packets.current.splice(0, 1000);
    setCounts((c) => ({ total: c.total + 1, valid: c.valid + (p.valid ? 1 : 0) }));
    flushTimer.current ??= setTimeout(() => {
      flushTimer.current = null;
      setShown(packets.current.slice(-MAX_SHOWN));
    }, 200);
  };

  // Keep the newest packet in view unless the user scrolled up.
  useEffect(() => {
    const el = list.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [shown, showInvalid]);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  const visible = showInvalid ? shown : shown.filter((p) => p.valid);
  const current = visible.find((p) => p.id === selected) ?? undefined;

  const addModbus = (frame: Uint8Array): void =>
    add({
      protocol: 'modbus',
      raw: toHexString(frame),
      size: frame.length,
      text: decodeModbusRtu(frame),
      valid: isModbusRtuValid(frame),
    });

  /** Line-based protocols: NMEA ($…*CS) and Modbus ASCII (:…LRC). */
  const addLine = (kind: 'nmea' | 'modbus-ascii', line: string): void =>
    add(
      kind === 'nmea'
        ? {
            protocol: kind,
            raw: line.trim(),
            size: line.trim().length,
            text: decodeNmea(line),
            valid: isNmeaValid(line),
          }
        : {
            protocol: kind,
            raw: line.trim(),
            size: line.trim().length,
            text: decodeModbusAscii(line),
            valid: isModbusAsciiValid(line),
          },
    );

  useEffect(() => {
    setBusy('protocol', live);
    if (!live) return;
    let bytes: number[] = [];
    let text = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flushModbus = (): void => {
      if (bytes.length >= 4) addModbus(Uint8Array.from(bytes));
      bytes = [];
    };

    const off = rxBus.on((chunk) => {
      if (protocol === 'modbus') {
        // Collect bytes until the line goes quiet – the chunk boundaries of
        // the operating system have nothing to do with telegram boundaries.
        bytes.push(...chunk.data);
        if (bytes.length > 512) bytes = bytes.slice(-512);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flushModbus, MODBUS_GAP_MS);
        return;
      }
      text += decodeLatin1(chunk.data);
      const lines = text.split(/\r?\n/);
      text = (lines.pop() ?? '').slice(-1024);
      const start = protocol === 'nmea' ? '$' : ':';
      for (const line of lines) {
        if (line.trim().startsWith(start)) addLine(protocol, line);
      }
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, protocol]);

  const decode = (input: string): void => {
    setInputError('');
    if (!input.trim()) return;
    follow.current = true;
    if (protocol !== 'modbus') {
      addLine(protocol, input);
    } else {
      try {
        addModbus(parseSendData(input, 'HEX'));
      } catch (err) {
        setInputError(err instanceof InputError ? err.message : String(err));
        return;
      }
    }
    // A packet decoded by hand is shown in the details at once.
    setSelected(nextId.current - 1);
  };

  const clear = (): void => {
    packets.current = [];
    setShown([]);
    setSelected(null);
    setCounts({ total: 0, valid: 0 });
  };

  const exportCsv = async (): Promise<void> => {
    if (!packets.current.length) {
      await alertDialog(t('export.emptyTitle'), t('protocol.exportEmpty'));
      return;
    }
    const header = [
      t('export.col.time'),
      t('protocol.protocol'),
      t('protocol.validCol'),
      t('protocol.rawCol'),
      t('protocol.decodedCol'),
    ];
    const rows = packets.current.map((p) =>
      [new Date(p.t).toISOString(), PROTOCOL_NAMES[p.protocol], p.valid ? '1' : '0', p.raw, p.text]
        .map(csvCell)
        .join(';'),
    );
    const content = `\uFEFF${[header.join(';'), ...rows].join('\r\n')}\r\n`;
    const path = await window.smp.files.saveText(`decoded_${fileStamp()}.csv`, content, [
      { name: 'CSV', extensions: ['csv'] },
    ]);
    if (path) {
      setStatus(t('export.saved', { path }), 'ok');
      toast(t('export.saved', { path }), 'ok');
    }
  };

  const invalid = counts.total - counts.valid;
  const rate = counts.total ? Math.round((counts.valid / counts.total) * 1000) / 10 : 0;

  return (
    <>
      <PageHeader title={t('protocol.title')} description={t('protocol.description')}>
        <div className="row nowrap" data-testid="protocol-stats">
          <span className="badge badge-info">{t('protocol.total', { count: counts.total })}</span>
          <span className="badge badge-ok">{t('protocol.valid', { count: counts.valid })}</span>
          <span className={invalid ? 'badge badge-bad' : 'badge'}>
            {t('protocol.invalid', { count: invalid })}
          </span>
          <span className="badge">{t('protocol.rate', { rate })}</span>
        </div>
      </PageHeader>
      <Card title={t('protocol.settings')} icon={Binary}>
        <div className="row">
          <span className="toolbar-label">{t('protocol.protocol')}</span>
          <Select<Protocol>
            value={protocol}
            options={(Object.keys(PROTOCOL_NAMES) as Protocol[]).map((value) => ({
              value,
              label: PROTOCOL_NAMES[value],
            }))}
            onChange={setProtocol}
            data-testid="protocol-select"
            style={{ width: 160 }}
          />
          <Check checked={live} onChange={setLive} switchStyle testId="protocol-live">
            {t('protocol.live')}
          </Check>
          <Check checked={showInvalid} onChange={setShowInvalid} testId="protocol-show-invalid">
            {t('protocol.showInvalid')}
          </Check>
        </div>
        {inputError && (
          <div className="notice" style={{ marginTop: 10 }} data-testid="protocol-error">
            {inputError}
          </div>
        )}
        <div className="row nowrap" style={{ marginTop: 10 }}>
          <Input
            mono
            className="grow"
            value={test}
            placeholder={t('protocol.testPlaceholder')}
            onChange={hex(protocol === 'modbus' ? 'HEX' : 'ASCII', setTest)}
            onKeyDown={(e) => e.key === 'Enter' && decode(test)}
            data-testid="protocol-input"
          />
          <Button
            variant="primary"
            icon={Languages}
            onClick={() => decode(test)}
            data-testid="protocol-decode"
          >
            {t('protocol.decode')}
          </Button>
          <Button
            icon={Lightbulb}
            data-testid="protocol-example"
            onClick={() => {
              setTest(EXAMPLES[protocol]);
              decode(EXAMPLES[protocol]);
            }}
          >
            {t('protocol.example')}
          </Button>
        </div>
      </Card>
      <Card
        title={t('protocol.output')}
        icon={ScrollText}
        fill
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={Download}
              onClick={() => void exportCsv()}
              data-testid="protocol-export"
            >
              {t('protocol.export')}
            </Button>
            <Button size="sm" variant="ghost" icon={Eraser} onClick={clear}>
              {t('common.clearOutput')}
            </Button>
          </>
        }
      >
        <div className="packets">
          <div
            className="packet-list"
            role="listbox"
            ref={list}
            data-testid="protocol-output"
            onScroll={(e) => {
              const el = e.currentTarget;
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {visible.length === 0 && <Empty icon={Binary}>{t('protocol.empty')}</Empty>}
            {visible.map((p) => (
              <div
                key={p.id}
                role="option"
                aria-selected={p.id === selected}
                className={p.valid ? 'packet-row' : 'packet-row invalid'}
                onClick={() => setSelected(p.id)}
              >
                <span className="mono muted">{formatTimestamp(p.t, 'time-ms')}</span>
                <span className={p.valid ? 'ok' : 'bad'}>{p.valid ? '✓' : '✗'}</span>
                <span className="packet-text">{p.text}</span>
              </div>
            ))}
          </div>
          <PacketDetails packet={current} />
        </div>
      </Card>
    </>
  );
}
