import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Boxes, Eraser, Scissors } from 'lucide-react';
import { CRC_NAMES } from '@shared/core/crc';
import { parseSendData } from '@shared/core/format';
import {
  describeFrame,
  findFrames,
  frameSpec,
  type FrameSpec,
  type LengthCounts,
} from '@shared/core/frames';
import type { FrameConfig } from '@shared/core/settings';
import { TextLog, type TextLogHandle } from '../components/LogView';
import {
  Button,
  Card,
  Check,
  Field,
  Input,
  NumberInput,
  PageHeader,
  Select,
} from '../components/ui';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import { useStore } from '../lib/store';
import { appStore, setBusy, updateSettings } from '../state/app';
import { rxBus } from '../state/serial';
import { alertDialog } from '../state/ui';

function hexOrEmpty(text: string): Uint8Array {
  try {
    return parseSendData(text, 'HEX');
  } catch {
    return new Uint8Array();
  }
}

export function specFromConfig(c: FrameConfig): FrameSpec {
  return frameSpec({
    header: hexOrEmpty(c.header),
    footer: hexOrEmpty(c.footer),
    lengthOffset: c.lengthSize > 0 ? 0 : -1,
    lengthSize: c.lengthSize || 1,
    lengthCounts: c.lengthCounts,
    crcAlgo: c.crc,
    crcBigEndian: c.crcBigEndian,
    fixedLength: c.fixedLength,
  });
}

export function FrameParserPage(): ReactNode {
  const t = useT();
  const config = useStore(appStore, (s) => s.settings.frame);
  const [live, setLive] = useState(false);
  const [test, setTest] = useState('');
  const [stats, setStats] = useState({ frames: 0, ok: 0, bad: 0 });
  const log = useRef<TextLogHandle>(null);
  const buffer = useRef<Uint8Array>(new Uint8Array());
  const configRef = useLatest(config);

  const set = (patch: Partial<FrameConfig>): void =>
    updateSettings({ frame: { ...config, ...patch } });

  useEffect(() => {
    setBusy('frameparser', live);
    if (!live) {
      buffer.current = new Uint8Array();
      return;
    }
    return rxBus.on((chunk) => {
      // The remainder of incomplete telegrams stays in the buffer – on a
      // serial line a telegram often arrives in several pieces.
      let buf = new Uint8Array(buffer.current.length + chunk.data.length);
      buf.set(buffer.current);
      buf.set(chunk.data, buffer.current.length);
      if (buf.length > 65536) buf = buf.slice(-4096); // protection against a wrong layout
      const spec = specFromConfig(configRef.current);
      const { frames, rest } = findFrames(buf, spec);
      buffer.current = rest;
      if (!frames.length) return;
      let ok = 0;
      let bad = 0;
      for (const f of frames) {
        if (f.crcOk === true) ok++;
        if (f.crcOk === false) bad++;
        log.current?.append(
          describeFrame(f, spec),
          f.crcOk === false ? 'err' : f.crcOk ? 'ok' : 'rx',
        );
      }
      setStats((s) => ({ frames: s.frames + frames.length, ok: s.ok + ok, bad: s.bad + bad }));
    });
  }, [live, configRef]);

  const parseTest = (): void => {
    let raw: Uint8Array;
    try {
      raw = parseSendData(test, 'HEX');
    } catch {
      void alertDialog(t('error.inputTitle'), t('frames.testInvalid'), 'warn');
      return;
    }
    if (!raw.length) return;
    const spec = specFromConfig(config);
    const { frames, rest } = findFrames(raw, spec);
    log.current?.append('─'.repeat(60), 'sys');
    if (!frames.length) {
      log.current?.append(t('frames.noneFound', { rest: rest.length }), 'sys');
      return;
    }
    for (const f of frames) {
      log.current?.append(
        describeFrame(f, spec),
        f.crcOk === false ? 'err' : f.crcOk ? 'ok' : 'rx',
      );
    }
    if (rest.length) log.current?.append(t('frames.rest', { rest: rest.length }), 'sys');
  };

  return (
    <>
      <PageHeader title={t('frames.title')} description={t('frames.description')}>
        <span className="badge badge-info">{t('frames.statFrames', { n: stats.frames })}</span>
        <span className="badge badge-ok">CRC ✓ {stats.ok}</span>
        <span className="badge badge-bad">CRC ✗ {stats.bad}</span>
      </PageHeader>

      <Card title={t('frames.layout')} icon={Boxes}>
        <div className="form-grid">
          <Field label={t('frames.header')} hint={t('frames.headerHint')}>
            <Input
              mono
              value={config.header}
              placeholder="AA 55"
              onChange={(e) => set({ header: e.target.value })}
              data-testid="frame-header"
            />
          </Field>
          <Field label={t('frames.footer')} hint={t('frames.footerHint')}>
            <Input
              mono
              value={config.footer}
              placeholder="03"
              onChange={(e) => set({ footer: e.target.value })}
            />
          </Field>
          <Field label={t('frames.lengthField')}>
            <Select<0 | 1 | 2>
              value={config.lengthSize}
              options={[
                { value: 0, label: t('frames.length.none') },
                { value: 1, label: t('frames.length.1') },
                { value: 2, label: t('frames.length.2') },
              ]}
              onChange={(lengthSize) => set({ lengthSize })}
            />
          </Field>
          <Field label={t('frames.counts')}>
            <Select<LengthCounts>
              value={config.lengthCounts}
              disabled={config.lengthSize === 0}
              options={[
                { value: 'payload', label: t('frames.counts.payload') },
                { value: 'payload_crc', label: t('frames.counts.payloadCrc') },
                { value: 'frame', label: t('frames.counts.frame') },
              ]}
              onChange={(lengthCounts) => set({ lengthCounts })}
            />
          </Field>
          <Field label={t('frames.crc')}>
            <Select<string>
              value={config.crc}
              options={[
                { value: '', label: t('frames.crc.none') },
                ...CRC_NAMES.map((n) => ({ value: n, label: n })),
              ]}
              onChange={(crc) => set({ crc })}
              data-testid="frame-crc"
            />
          </Field>
          <Field label={t('frames.byteOrder')}>
            <Select<'be' | 'le'>
              value={config.crcBigEndian ? 'be' : 'le'}
              options={[
                { value: 'be', label: 'Big-Endian' },
                { value: 'le', label: 'Little-Endian' },
              ]}
              onChange={(v) => set({ crcBigEndian: v === 'be' })}
            />
          </Field>
          <Field label={t('frames.fixedLength')} hint={t('frames.fixedLengthHint')}>
            <NumberInput
              value={config.fixedLength}
              min={0}
              max={4096}
              onChange={(fixedLength) => set({ fixedLength })}
            />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Check checked={live} onChange={setLive} switchStyle testId="frame-live">
            {t('frames.live')}
          </Check>
          <span className="spacer" />
          <Button
            size="sm"
            data-testid="frame-example-modbus"
            onClick={() => {
              set({
                header: '',
                footer: '',
                lengthSize: 0,
                crc: 'CRC-16/MODBUS',
                crcBigEndian: false,
                fixedLength: 8,
              });
              setTest('01 03 00 00 00 0A C5 CD');
              log.current?.append(t('frames.exampleModbus'), 'sys');
            }}
          >
            {t('frames.exampleModbusButton')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              set({
                header: 'AA 55',
                footer: '',
                lengthSize: 1,
                lengthCounts: 'payload',
                crc: 'CRC-8',
                crcBigEndian: true,
                fixedLength: 0,
              });
              setTest('AA 55 03 11 22 33 33');
              log.current?.append(t('frames.exampleHeader'), 'sys');
            }}
          >
            {t('frames.exampleHeaderButton')}
          </Button>
          <Button
            size="sm"
            icon={Eraser}
            onClick={() => {
              log.current?.clear();
              setStats({ frames: 0, ok: 0, bad: 0 });
            }}
          >
            {t('common.clearOutput')}
          </Button>
        </div>
      </Card>

      <div className="row nowrap">
        <Input
          mono
          className="grow"
          value={test}
          placeholder={t('frames.testPlaceholder')}
          onChange={(e) => setTest(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && parseTest()}
          data-testid="frame-test-input"
        />
        <Button
          variant="primary"
          icon={Scissors}
          onClick={parseTest}
          data-testid="frame-test-parse"
        >
          {t('frames.parse')}
        </Button>
      </div>

      <TextLog ref={log} emptyIcon={Boxes} empty={t('frames.empty')} testId="frame-output" />
    </>
  );
}
