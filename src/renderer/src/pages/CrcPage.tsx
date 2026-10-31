import { useMemo, useState, type ReactNode } from 'react';
import { Calculator, FlaskConical, ShieldCheck } from 'lucide-react';
import { toHexString, writeUInt } from '@shared/core/bytes';
import { calculateCrc, CRC_NAMES, CRC_PRESETS, formatCrc, type CrcName } from '@shared/core/crc';
import { DATA_FORMATS, InputError, parseSendData, type DataFormat } from '@shared/core/format';
import { insertTransmitCrc, type TransmitCrcConfig } from '@shared/core/transmit-crc';
import {
  Button,
  Card,
  Check,
  Empty,
  Field,
  Input,
  NumberInput,
  PageHeader,
  Select,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, updateSettings } from '../state/app';

function Value({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}): ReactNode {
  return (
    <div className={small ? 'crc-value small' : 'crc-value'}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function CrcPage(): ReactNode {
  const t = useT();
  const [fmt, setFmt] = useState<DataFormat>('HEX');
  const config = useStore(appStore, (s) => s.settings.transmitCrc);
  const algo = config.algorithm;
  const set = (patch: Partial<TransmitCrcConfig>): void =>
    updateSettings({ transmitCrc: { ...config, ...patch } });
  const setAlgo = (algorithm: CrcName): void => set({ algorithm });
  const [input, setInput] = useState('');
  const [compare, setCompare] = useState(false);

  const parsed = useMemo((): { data: Uint8Array | null; error: string } => {
    try {
      return { data: parseSendData(input, fmt), error: '' };
    } catch (err) {
      return { data: null, error: err instanceof InputError ? err.message : String(err) };
    }
  }, [input, fmt]);

  const result = useMemo(() => {
    if (!parsed.data?.length) return { built: null, error: parsed.error };
    try {
      return { built: insertTransmitCrc(parsed.data, config), error: '' };
    } catch (err) {
      return { built: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [parsed, config]);
  const data = result.built?.covered;
  const width = CRC_PRESETS[algo].width;
  const value = result.built?.value ?? null;
  const be = value === null ? null : writeUInt(value, width / 8, true);
  const le = value === null ? null : writeUInt(value, width / 8, false);

  return (
    <>
      <PageHeader title={t('crc.title')} description={t('crc.description')} />
      <Card title={t('crc.input')} icon={Calculator}>
        <div className="form-grid" style={{ gridTemplateColumns: '110px 220px 1fr' }}>
          <Field label={t('command.format')}>
            <Select<DataFormat>
              value={fmt}
              options={DATA_FORMATS}
              onChange={setFmt}
              data-testid="crc-format"
            />
          </Field>
          <Field label={t('crc.algorithm')}>
            <Select<CrcName>
              value={algo}
              options={CRC_NAMES}
              onChange={setAlgo}
              data-testid="crc-algo"
            />
          </Field>
          <Field label={t('crc.data')}>
            <Input
              mono
              value={input}
              placeholder={t('crc.placeholder')}
              onChange={(e) => setInput(e.target.value)}
              aria-invalid={Boolean(parsed.error)}
              data-testid="crc-input"
            />
          </Field>
        </div>
        <div
          className="form-grid"
          style={{ gridTemplateColumns: '180px 150px 1fr 1fr', marginTop: 12 }}
        >
          <Field label={t('crc.endian')}>
            <Select
              value={config.bigEndian ? 'big' : 'little'}
              options={[
                { value: 'little', label: 'Little-Endian' },
                { value: 'big', label: 'Big-Endian' },
              ]}
              onChange={(value) => set({ bigEndian: value === 'big' })}
              data-testid="crc-endian"
            />
          </Field>
          <Field label={t('crc.position')}>
            <NumberInput
              value={config.position}
              onChange={(position) => set({ position })}
              data-testid="crc-position"
            />
          </Field>
          <Field label={t('crc.header')}>
            <Input
              mono
              value={config.header}
              onChange={(e) => set({ header: e.target.value })}
              placeholder="AA 55"
              data-testid="crc-header"
            />
            <Check
              checked={config.includeHeader}
              onChange={(includeHeader) => set({ includeHeader })}
              testId="crc-include-header"
            >
              {t('crc.includeHeader')}
            </Check>
          </Field>
          <Field label={t('crc.footer')}>
            <Input
              mono
              value={config.footer}
              onChange={(e) => set({ footer: e.target.value })}
              placeholder="0D 0A"
              data-testid="crc-footer"
            />
            <Check
              checked={config.includeFooter}
              onChange={(includeFooter) => set({ includeFooter })}
              testId="crc-include-footer"
            >
              {t('crc.includeFooter')}
            </Check>
          </Field>
        </div>
        <p className="muted small">
          {t('crc.positionHint')} {t('crc.framingHint')}
        </p>
        <Check checked={config.enabled} onChange={(enabled) => set({ enabled })} testId="crc-auto">
          {t('crc.auto')}
        </Check>
        <p className="muted small">{t('crc.scope')}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <Button
            variant={compare ? 'default' : 'primary'}
            icon={ShieldCheck}
            onClick={() => setCompare(false)}
          >
            {t('crc.single')}
          </Button>
          <Button
            variant={compare ? 'primary' : 'default'}
            onClick={() => setCompare(true)}
            data-testid="crc-compare"
          >
            {t('crc.compareAll')}
          </Button>
          <Button
            icon={FlaskConical}
            title={t('crc.checkVectorTip')}
            data-testid="crc-check-vector"
            onClick={() => {
              setFmt('ASCII');
              setInput('123456789');
            }}
          >
            {t('crc.checkVector')}
          </Button>
        </div>
      </Card>

      <Card title={t('crc.result')} fill>
        {result.error ? (
          <div className="notice" data-testid="crc-error">
            {result.error}
          </div>
        ) : !data ? (
          <Empty icon={ShieldCheck}>{t('crc.empty')}</Empty>
        ) : compare ? (
          <div className="table-wrap">
            <table className="table" data-testid="crc-table">
              <thead>
                <tr>
                  <th>{t('crc.algorithm')}</th>
                  <th>{t('crc.width')}</th>
                  <th>HEX</th>
                  <th>DEC</th>
                </tr>
              </thead>
              <tbody>
                {CRC_NAMES.map((name) => {
                  const v = calculateCrc(data, name);
                  return (
                    <tr key={name} aria-selected={name === algo} onClick={() => setAlgo(name)}>
                      <td>{name}</td>
                      <td>{CRC_PRESETS[name].width} Bit</td>
                      <td className="mono selectable">0x{formatCrc(v, name)}</td>
                      <td className="mono selectable">{v}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          value !== null &&
          be &&
          le && (
            <>
              <div className="crc-result" data-testid="crc-result">
                <Value label={`${algo} · HEX`} value={`0x${formatCrc(value, algo)}`} />
                <Value label="DEC" value={String(value)} />
                <Value label="BIN" value={value.toString(2).padStart(width, '0')} small />
                <Value label={t('crc.bytesBe')} value={toHexString(be)} small />
                <Value label={t('crc.bytesLe')} value={toHexString(le)} small />
              </div>
              <div className="section-title">{t('crc.withCrc')}</div>
              <dl className="detail selectable">
                <dt>{t('crc.covered')}</dt>
                <dd className="mono">
                  {toHexString(data)} <span className="muted">({data.length} B)</span>
                </dd>
                <dt>{config.bigEndian ? 'Big-Endian' : 'Little-Endian'}</dt>
                <dd className="mono" data-testid="crc-packet">
                  {result.built && toHexString(result.built.packet)}
                </dd>
              </dl>
            </>
          )
        )}
      </Card>
    </>
  );
}
