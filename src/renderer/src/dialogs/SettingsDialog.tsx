import { useState, type ReactNode } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import type { LanguageSetting } from '@shared/i18n';
import { formatHexInput } from '@shared/core/format';
import { DEFAULT_SETTINGS, type RxSplit, type Settings, type Theme } from '@shared/core/settings';
import { TIMESTAMP_FORMATS, formatTimestamp, type TimestampFormat } from '@shared/core/timestamp';
import { Modal } from '../components/Modal';
import { Button, Check, Field, NumberInput, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useStore } from '../lib/store';
import { applyPaths, appStore, updateSettings } from '../state/app';
import { refreshPorts } from '../state/serial';
import { confirmDialog, toast } from '../state/ui';

export function SettingsDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const info = useStore(appStore, (s) => s.info);
  const saved = useStore(appStore, (s) => s.settings);
  const [s, setS] = useState<Settings>(saved);
  const set = (patch: Partial<Settings>): void => setS((x) => ({ ...x, ...patch }));
  const example = formatHexInput('0a1b2c3d', -1, {
    uppercase: s.hexUppercase,
    group: s.hexGroup,
    groupSize: s.hexGroupSize,
  }).text;
  const sample = Date.UTC(2026, 7, 12, 10, 34, 56, 789);

  const save = (): void => {
    const simulatorChanged = s.simulator !== saved.simulator;
    const pathsChanged =
      s.paths.dataDir !== saved.paths.dataDir || s.paths.logDir !== saved.paths.logDir;
    updateSettings(s);
    if (simulatorChanged) void refreshPorts();
    if (pathsChanged)
      void applyPaths(s.paths).then((ok) =>
        toast(ok ? t('settings.foldersApplied') : t('settings.folderInvalid'), ok ? 'ok' : 'warn'),
      );
    onClose();
  };

  const chooseFolder = async (key: 'dataDir' | 'logDir', title: string): Promise<void> => {
    const dir = await window.smp.files.chooseFolder(s.paths[key], title);
    if (dir) set({ paths: { ...s.paths, [key]: dir } });
  };

  const folderRow = (key: 'dataDir' | 'logDir', label: string, hint: string, fallback: string) => (
    <div className="folder-row" data-testid={`folder-${key}`}>
      <div className="grow">
        <div className="folder-label">{label}</div>
        <div className="mono small selectable folder-path">
          {s.paths[key] || `${t('settings.folderDefault')} – ${fallback}`}
        </div>
        <div className="muted small">{hint}</div>
      </div>
      <Button
        size="sm"
        onClick={() => void chooseFolder(key, label)}
        data-testid={`folder-${key}-choose`}
      >
        {t('settings.folderChoose')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!s.paths[key]}
        onClick={() => set({ paths: { ...s.paths, [key]: '' } })}
      >
        {t('settings.folderReset')}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t('settings.title')}
      icon={SettingsIcon}
      wide
      onClose={onClose}
      testId="settings-dialog"
      footer={
        <>
          <Button
            onClick={() =>
              void confirmDialog(
                t('settings.resetTitle'),
                t('settings.resetQuestion'),
                t('settings.reset'),
                t('common.cancel'),
                true,
              ).then((ok) => {
                if (ok) {
                  setS({
                    ...DEFAULT_SETTINGS,
                    port: s.port,
                    frame: s.frame,
                    graph: s.graph,
                    // Data rather than preferences: keep them.
                    triggers: s.triggers,
                    schedules: s.schedules,
                    paths: s.paths,
                    simulator: info?.simulatorForced ? true : DEFAULT_SETTINGS.simulator,
                  });
                }
              })
            }
          >
            {t('settings.reset')}
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} data-testid="settings-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="section-title">{t('settings.general')}</div>
      <div className="form-grid">
        <Field label={t('settings.language')}>
          <Select<LanguageSetting>
            value={s.language}
            data-testid="settings-language"
            options={[
              { value: 'auto', label: t('settings.language.auto') },
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(language) => set({ language })}
          />
        </Field>
        <Field label={t('settings.theme')}>
          <Select<Theme>
            value={s.theme}
            options={[
              { value: 'system', label: t('settings.theme.system') },
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
            ]}
            onChange={(theme) => set({ theme })}
          />
        </Field>
      </div>
      <div className="row">
        <Check
          checked={s.updateCheck}
          onChange={(updateCheck) => set({ updateCheck })}
          testId="settings-updatecheck"
        >
          {t('settings.updateCheck')}
        </Check>
      </div>
      <div className="field-hint">{t('settings.updateHint')}</div>

      <div className="section-title">{t('settings.display')}</div>
      <div className="form-grid">
        <Field label={t('settings.fontSize')}>
          <NumberInput
            value={s.fontSize}
            min={9}
            max={32}
            onChange={(fontSize) => set({ fontSize })}
          />
        </Field>
        <Field label={t('settings.maxLines')} hint={t('settings.maxLinesHint')}>
          <NumberInput
            value={s.maxLines}
            min={1000}
            max={200000}
            step={1000}
            onChange={(maxLines) => set({ maxLines })}
          />
        </Field>
        <Field label={t('settings.timestampFormat')}>
          <Select<TimestampFormat>
            value={s.timestampFormat}
            options={TIMESTAMP_FORMATS.map((f) => ({
              value: f,
              label: formatTimestamp(sample, f),
            }))}
            onChange={(timestampFormat) => set({ timestampFormat })}
          />
        </Field>
        <Field label={t('settings.rxSplit')}>
          <Select<RxSplit>
            value={s.rxSplit}
            options={[
              { value: 'newline', label: t('settings.rxSplit.newline') },
              { value: 'packet', label: t('settings.rxSplit.packet') },
            ]}
            onChange={(rxSplit) => set({ rxSplit })}
          />
        </Field>
        <Field label={t('settings.lineTimeout')} hint={t('settings.lineTimeoutHint')}>
          <NumberInput
            value={s.lineTimeoutMs}
            min={5}
            max={5000}
            onChange={(lineTimeoutMs) => set({ lineTimeoutMs })}
          />
        </Field>
      </div>

      <div className="section-title">{t('settings.hexInput')}</div>
      <div className="row">
        <Check checked={s.hexUppercase} onChange={(hexUppercase) => set({ hexUppercase })}>
          {t('settings.hexUppercase')}
        </Check>
        <Check checked={s.hexGroup} onChange={(hexGroup) => set({ hexGroup })}>
          {t('settings.hexGroup')}
        </Check>
        <Field label={t('settings.hexGroupSize')}>
          <NumberInput
            value={s.hexGroupSize}
            min={1}
            max={8}
            disabled={!s.hexGroup}
            onChange={(hexGroupSize) => set({ hexGroupSize })}
            style={{ width: 80 }}
          />
        </Field>
      </div>
      <div className="code-block">0a1b2c3d → {example}</div>

      <div className="section-title">{t('settings.sending')}</div>
      <div className="row">
        <Check checked={s.clearAfterSend} onChange={(clearAfterSend) => set({ clearAfterSend })}>
          {t('settings.clearAfterSend')}
        </Check>
        <Check checked={s.sendHistory} onChange={(sendHistory) => set({ sendHistory })}>
          {t('settings.sendHistory')}
        </Check>
        <Check checked={s.echoSent} onChange={(echoSent) => set({ echoSent })}>
          {t('settings.echoSent')}
        </Check>
      </div>

      <div className="section-title">{t('settings.connection')}</div>
      <div className="row">
        <Check
          checked={s.autoReconnect}
          onChange={(autoReconnect) => set({ autoReconnect })}
          testId="settings-autoreconnect"
        >
          {t('settings.autoReconnect')}
        </Check>
        <Check
          checked={s.simulator}
          disabled={info?.simulatorForced}
          onChange={(simulator) => set({ simulator })}
          testId="settings-simulator"
        >
          {t('settings.simulator')}
        </Check>
      </div>
      <div className="field-hint">{t('settings.simulatorHint')}</div>

      <div className="section-title">{t('settings.storage')}</div>
      {folderRow(
        'dataDir',
        t('settings.folderData'),
        t('settings.folderDataHint'),
        info?.paths.userData ?? '',
      )}
      {folderRow(
        'logDir',
        t('settings.folderLogs'),
        t('settings.folderLogsHint'),
        info?.paths.logs ?? '',
      )}
      <div className="code-block" data-testid="storage-paths">
        {info && (
          <>
            {t('settings.storage.settings')}: {info.paths.settings}
            <br />
            {t('settings.storage.commands')}: {info.paths.commands}
            <br />
            {t('settings.storage.automation')}: {info.paths.automation}
            <br />
            {t('settings.storage.logs')}: {info.paths.logs}
          </>
        )}
      </div>
    </Modal>
  );
}
