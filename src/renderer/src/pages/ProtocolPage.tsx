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
import { fileStamp } from '@shared/core/timestamp';
import { TextLog, type TextLogHandle } from '../components/LogView';
import { Button, Card, Check, Input, PageHeader, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
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
  t: number;
  protocol: Protocol;
  raw: string;
  text: string;
  valid: boolean;
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
  const [counts, setCounts] = useState({ total: 0, valid: 0 });
  const log = useRef<TextLogHandle>(null);
  const packets = useRef<Packet[]>([]);
  const showInvalidRef = useLatest(showInvalid);

  /** Counts, keeps and shows one decoded packet. */
  const add = (p: Omit<Packet, 't'>): void => {
    packets.current.push({ ...p, t: Date.now() });
    if (packets.current.length > MAX_PACKETS) packets.current.splice(0, 1000);
    setCounts((c) => ({ total: c.total + 1, valid: c.valid + (p.valid ? 1 : 0) }));
    if (p.valid || showInvalidRef.current) log.current?.append(p.text, p.valid ? 'rx' : 'err');
  };

  const addModbus = (frame: Uint8Array): void =>
    add({
      protocol: 'modbus',
      raw: toHexString(frame),
      text: decodeModbusRtu(frame),
      valid: isModbusRtuValid(frame),
    });

  /** Line-based protocols: NMEA ($…*CS) and Modbus ASCII (:…LRC). */
  const addLine = (kind: 'nmea' | 'modbus-ascii', line: string): void =>
    add(
      kind === 'nmea'
        ? { protocol: kind, raw: line.trim(), text: decodeNmea(line), valid: isNmeaValid(line) }
        : {
            protocol: kind,
            raw: line.trim(),
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
    if (!input.trim()) return;
    log.current?.append('─'.repeat(60), 'sys');
    if (protocol !== 'modbus') {
      addLine(protocol, input);
      return;
    }
    try {
      addModbus(parseSendData(input, 'HEX'));
    } catch (err) {
      log.current?.append(err instanceof InputError ? err.message : String(err), 'err');
    }
  };

  const clear = (): void => {
    log.current?.clear();
    packets.current = [];
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
        <div className="row nowrap" style={{ marginTop: 10 }}>
          <Input
            mono
            className="grow"
            value={test}
            placeholder={t('protocol.testPlaceholder')}
            onChange={(e) => setTest(e.target.value)}
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
        <TextLog
          ref={log}
          emptyIcon={Binary}
          empty={t('protocol.empty')}
          testId="protocol-output"
        />
      </Card>
    </>
  );
}
