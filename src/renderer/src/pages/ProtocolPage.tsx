import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Binary, Eraser, Languages, Lightbulb } from 'lucide-react';
import { decodeLatin1 } from '@shared/core/bytes';
import { InputError, parseSendData } from '@shared/core/format';
import { decodeModbusRtu } from '@shared/core/modbus';
import { decodeNmea } from '@shared/core/nmea';
import { TextLog, type TextLogHandle } from '../components/LogView';
import { Button, Card, Check, Input, PageHeader, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { setBusy } from '../state/app';
import { rxBus } from '../state/serial';

type Protocol = 'modbus' | 'nmea';

const EXAMPLES: Record<Protocol, string> = {
  modbus: '01 03 00 00 00 0A C5 CD',
  nmea: '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47',
};

/** Modbus RTU frames are separated by a pause of at least 3.5 characters. */
const MODBUS_GAP_MS = 20;

export function ProtocolPage(): ReactNode {
  const t = useT();
  const [protocol, setProtocol] = useState<Protocol>('modbus');
  const [live, setLive] = useState(false);
  const [test, setTest] = useState('');
  const log = useRef<TextLogHandle>(null);

  useEffect(() => {
    setBusy('protocol', live);
    if (!live) return;
    let bytes: number[] = [];
    let text = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flushModbus = (): void => {
      if (bytes.length >= 4) log.current?.append(decodeModbusRtu(Uint8Array.from(bytes)));
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
      for (const line of lines) {
        if (!line.trim().startsWith('$')) continue;
        const decoded = decodeNmea(line);
        log.current?.append(decoded, decoded.includes('✗') ? 'err' : 'rx');
      }
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [live, protocol]);

  const decode = (): void => {
    const input = test.trim();
    if (!input) return;
    log.current?.append('─'.repeat(60), 'sys');
    if (protocol === 'nmea') {
      log.current?.append(decodeNmea(input));
      return;
    }
    try {
      log.current?.append(decodeModbusRtu(parseSendData(input, 'HEX')));
    } catch (err) {
      log.current?.append(err instanceof InputError ? err.message : String(err), 'err');
    }
  };

  return (
    <>
      <PageHeader title={t('protocol.title')} description={t('protocol.description')} />
      <Card title={t('protocol.settings')} icon={Binary}>
        <div className="row">
          <span className="toolbar-label">{t('protocol.protocol')}</span>
          <Select<Protocol>
            value={protocol}
            options={[
              { value: 'modbus', label: 'Modbus RTU' },
              { value: 'nmea', label: 'NMEA 0183' },
            ]}
            onChange={setProtocol}
            data-testid="protocol-select"
            style={{ width: 160 }}
          />
          <Check checked={live} onChange={setLive} switchStyle testId="protocol-live">
            {t('protocol.live')}
          </Check>
          <span className="spacer" />
          <Button size="sm" icon={Eraser} onClick={() => log.current?.clear()}>
            {t('common.clearOutput')}
          </Button>
        </div>
        <div className="row nowrap" style={{ marginTop: 10 }}>
          <Input
            mono
            className="grow"
            value={test}
            placeholder={t('protocol.testPlaceholder')}
            onChange={(e) => setTest(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && decode()}
            data-testid="protocol-input"
          />
          <Button variant="primary" icon={Languages} onClick={decode} data-testid="protocol-decode">
            {t('protocol.decode')}
          </Button>
          <Button
            icon={Lightbulb}
            data-testid="protocol-example"
            onClick={() => {
              setTest(EXAMPLES[protocol]);
              log.current?.append('─'.repeat(60), 'sys');
              log.current?.append(
                protocol === 'modbus'
                  ? decodeModbusRtu(parseSendData(EXAMPLES.modbus, 'HEX'))
                  : decodeNmea(EXAMPLES.nmea),
              );
            }}
          >
            {t('protocol.example')}
          </Button>
        </div>
      </Card>
      <TextLog ref={log} emptyIcon={Binary} empty={t('protocol.empty')} testId="protocol-output" />
    </>
  );
}
