import { useMemo, useState, type ReactNode } from 'react';
import { Calculator, FlaskConical, ShieldCheck } from 'lucide-react';
import { concatBytes, toHexString, writeUInt } from '@shared/core/bytes';
import { calculateCrc, CRC_NAMES, CRC_PRESETS, formatCrc, type CrcName } from '@shared/core/crc';
import { DATA_FORMATS, InputError, parseSendData, type DataFormat } from '@shared/core/format';
import { Button, Card, Empty, Field, Input, PageHeader, Select } from '../components/ui';
import { useT } from '../lib/i18n';

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
  const [algo, setAlgo] = useState<CrcName>('CRC-16/MODBUS');
  const [input, setInput] = useState('');
  const [compare, setCompare] = useState(false);

  const parsed = useMemo((): { data: Uint8Array | null; error: string } => {
    try {
      return { data: parseSendData(input, fmt), error: '' };
    } catch (err) {
      return { data: null, error: err instanceof InputError ? err.message : String(err) };
    }
  }, [input, fmt]);

  const data = parsed.data;
  const width = CRC_PRESETS[algo].width;
  const value = data?.length ? calculateCrc(data, algo) : null;
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
        {parsed.error ? (
          <div className="notice">{parsed.error}</div>
        ) : !data?.length ? (
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
                <dt>{t('crc.data')}</dt>
                <dd className="mono">
                  {toHexString(data)} <span className="muted">({data.length} B)</span>
                </dd>
                <dt>Big-Endian</dt>
                <dd className="mono">{toHexString(concatBytes(data, be))}</dd>
                <dt>Little-Endian</dt>
                <dd className="mono">{toHexString(concatBytes(data, le))}</dd>
              </dl>
            </>
          )
        )}
      </Card>
    </>
  );
}
