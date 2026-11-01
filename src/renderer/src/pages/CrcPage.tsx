// CRC Tools – laid out like the former Python version: transmit settings on
// the left, an independent calculator on the right.
import { useMemo, useState, type ReactNode } from 'react';
import { Calculator, FlaskConical, ListChecks, SendHorizontal, ShieldCheck } from 'lucide-react';
import { toHexString, writeUInt, concatBytes } from '@shared/core/bytes';
import { calculateCrc, CRC_NAMES, CRC_PRESETS, formatCrc, type CrcName } from '@shared/core/crc';
import { DATA_FORMATS, InputError, parseSendData, type DataFormat } from '@shared/core/format';
import {
  buildTransmitPacket,
  framingBytes,
  type TransmitCrcConfig,
} from '@shared/core/transmit-crc';
import { PacketPreview } from '../components/PacketPreview';
import {
  Button,
  Card,
  Check,
  Empty,
  Field,
  NumberInput,
  PageHeader,
  Select,
} from '../components/ui';
import { useHexChange } from '../components/useHexChange';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { appStore, setTab, updateSettings } from '../state/app';

const ENDIANS = [
  { value: 'big', label: 'Big-Endian' },
  { value: 'little', label: 'Little-Endian' },
] as const;

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

function hexWord(value: number, width: number): string {
  return `0x${value
    .toString(16)
    .toUpperCase()
    .padStart(width / 4, '0')}`;
}

/** Parameters of the selected algorithm (as shown by the Python version). */
function CrcParams({ algorithm }: { algorithm: CrcName }): ReactNode {
  const p = CRC_PRESETS[algorithm];
  return (
    <div className="code-block crc-params" data-testid="crc-params">
      <span>Width</span>
      <b>{p.width} bit</b>
      <span>Poly</span>
      <b>{hexWord(p.poly, p.width)}</b>
      <span>Init</span>
      <b>{hexWord(p.init, p.width)}</b>
      <span>XorOut</span>
      <b>{hexWord(p.xorout, p.width)}</b>
      <span>RefIn</span>
      <b>{String(p.refin)}</b>
      <span>RefOut</span>
      <b>{String(p.refout)}</b>
    </div>
  );
}

function TransmitSettings({ calcData }: { calcData: Uint8Array | null }): ReactNode {
  const t = useT();
  const config = useStore(appStore, (s) => s.settings.transmitCrc);
  const sendFormat = useStore(appStore, (s) => s.settings.sendFormat);
  const set = (patch: Partial<TransmitCrcConfig>): void =>
    updateSettings({ transmitCrc: { ...config, ...patch } });

  const example = useMemo(() => {
    if (!calcData?.length) return { packet: null, error: '' };
    try {
      const { header, footer } = framingBytes(config, sendFormat);
      return {
        packet: buildTransmitPacket(calcData, header, footer, { ...config, enabled: true }),
        error: '',
      };
    } catch (err) {
      return { packet: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [calcData, config, sendFormat]);

  const framing = (use: boolean, text: string): string =>
    `${text.trim() || t('crc.framingEmpty')} (${use ? t('crc.framingOn') : t('crc.framingOff')})`;

  return (
    <Card title={t('crc.txTitle')} icon={SendHorizontal} className="crc-tx">
      <div className="form-grid cols-2">
        <Field label={t('crc.algorithm')}>
          <Select<CrcName>
            value={config.algorithm}
            options={CRC_NAMES}
            onChange={(algorithm) => set({ algorithm })}
            data-testid="crc-tx-algo"
          />
        </Field>
        <Field label={t('crc.endian')}>
          <Select
            value={config.bigEndian ? 'big' : 'little'}
            options={ENDIANS}
            onChange={(value) => set({ bigEndian: value === 'big' })}
            data-testid="crc-endian"
          />
        </Field>
        <Field label={t('crc.position')} hint={t('crc.positionHint')} className="span-2">
          <NumberInput
            value={config.position}
            onChange={(position) => set({ position })}
            data-testid="crc-position"
            style={{ maxWidth: 140 }}
          />
        </Field>
      </div>
      <div className="stack">
        <Check
          checked={config.includeHeader}
          onChange={(includeHeader) => set({ includeHeader })}
          testId="crc-include-header"
        >
          {t('crc.includeHeader')}
        </Check>
        <Check
          checked={config.includeFooter}
          onChange={(includeFooter) => set({ includeFooter })}
          testId="crc-include-footer"
        >
          {t('crc.includeFooter')}
        </Check>
        <Check checked={config.enabled} onChange={(enabled) => set({ enabled })} testId="crc-auto">
          <b>{t('crc.auto')}</b>
        </Check>
      </div>
      <div className="framing-info">
        <div>
          <div className="muted small">{t('crc.framing')}</div>
          <div className="mono small" data-testid="crc-framing">
            {t('crc.header')}: {framing(config.useHeader, config.header)} · {t('crc.footer')}:{' '}
            {framing(config.useFooter, config.footer)}
          </div>
        </div>
        <Button size="sm" onClick={() => setTab('monitor')}>
          {t('crc.toMonitor')}
        </Button>
      </div>
      <p className="muted small">{t('crc.scope')}</p>

      <div className="section-title">{t('crc.example')}</div>
      {example.error ? (
        <div className="notice" data-testid="crc-error">
          {example.error}
        </div>
      ) : example.packet ? (
        <div className="packet-box" data-testid="crc-example">
          <PacketPreview packet={example.packet} testId="crc-packet" legend />
          <div className="muted small">
            {t('crc.covered')}: <span className="mono">{toHexString(example.packet.covered!)}</span>
          </div>
        </div>
      ) : (
        <p className="muted small">{t('crc.exampleEmpty')}</p>
      )}

      <div className="section-title">{t('crc.params')}</div>
      <CrcParams algorithm={config.algorithm} />
      <p className="muted small">{t('crc.note')}</p>
    </Card>
  );
}

export function CrcPage(): ReactNode {
  const t = useT();
  const txAlgorithm = useStore(appStore, (s) => s.settings.transmitCrc.algorithm);
  const txBigEndian = useStore(appStore, (s) => s.settings.transmitCrc.bigEndian);
  const [fmt, setFmt] = useState<DataFormat>('HEX');
  const [algo, setAlgo] = useState<CrcName>(txAlgorithm);
  const [bigEndian, setBigEndian] = useState(txBigEndian);
  const [input, setInput] = useState('');
  const [compare, setCompare] = useState(false);
  const hex = useHexChange();

  const parsed = useMemo((): { data: Uint8Array | null; error: string } => {
    try {
      return { data: parseSendData(input, fmt), error: '' };
    } catch (err) {
      return { data: null, error: err instanceof InputError ? err.message : String(err) };
    }
  }, [input, fmt]);

  const data = parsed.data?.length ? parsed.data : null;
  const width = CRC_PRESETS[algo].width;
  const value = data ? calculateCrc(data, algo) : null;
  const be = value === null ? null : writeUInt(value, width / 8, true);
  const le = value === null ? null : writeUInt(value, width / 8, false);

  return (
    <>
      <PageHeader title={t('crc.title')} description={t('crc.description')} />
      <div className="crc-layout">
        <TransmitSettings calcData={data} />
        <Card title={t('crc.calcTitle')} icon={Calculator} fill className="crc-calc">
          <div className="form-grid cols-3">
            <Field label={t('crc.inputFormat')}>
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
            <Field label={t('crc.endian')}>
              <Select
                value={bigEndian ? 'big' : 'little'}
                options={ENDIANS}
                onChange={(v) => setBigEndian(v === 'big')}
                data-testid="crc-calc-endian"
              />
            </Field>
            <Field label={t('crc.data')} className="span-3">
              <textarea
                className="input mono textarea"
                rows={3}
                spellCheck={false}
                value={input}
                placeholder={t('crc.placeholder')}
                onChange={hex(fmt, setInput)}
                aria-invalid={Boolean(parsed.error)}
                data-testid="crc-input"
              />
            </Field>
          </div>
          <div className="row">
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
            <span className="spacer" />
            <Check checked={compare} onChange={setCompare} testId="crc-compare">
              {t('crc.compareAll')}
            </Check>
          </div>

          <div className="section-title">
            {compare ? (
              <>
                <ListChecks size={13} strokeWidth={2.4} aria-hidden /> {t('crc.compareAll')}
              </>
            ) : (
              t('crc.result')
            )}
          </div>
          {parsed.error ? (
            <div className="notice" data-testid="crc-calc-error">
              {parsed.error}
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
                  <Value
                    label={bigEndian ? t('crc.bytesBe') : t('crc.bytesLe')}
                    value={toHexString(bigEndian ? be : le)}
                    small
                  />
                </div>
                <dl className="detail selectable" data-testid="crc-calc-packets">
                  <dt>{t('crc.dataBe')}</dt>
                  <dd className="mono">{toHexString(concatBytes(data, be))}</dd>
                  <dt>{t('crc.dataLe')}</dt>
                  <dd className="mono">{toHexString(concatBytes(data, le))}</dd>
                </dl>
              </>
            )
          )}
        </Card>
      </div>
    </>
  );
}
