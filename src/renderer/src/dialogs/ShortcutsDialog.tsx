import type { ReactNode } from 'react';
import { Keyboard } from 'lucide-react';
import { Modal } from '../components/Modal';
import { useT } from '../lib/i18n';

export function ShortcutsDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [
    [`${mod} + K`, t('shortcuts.connect')],
    ['F5', t('shortcuts.refresh')],
    [`${mod} + L`, t('shortcuts.clear')],
    [`${mod} + F`, t('shortcuts.filter')],
    [`${mod} + S`, t('shortcuts.exportTxt')],
    [`${mod} + Shift + S`, t('shortcuts.exportCsv')],
    [`${mod} + ,`, t('shortcuts.settings')],
    [`${mod} + 1 … 0`, t('shortcuts.tabs')],
    ['↑ / ↓', t('shortcuts.history')],
    ['Enter', t('shortcuts.send')],
    ['Esc', t('shortcuts.escape')],
    ['F1', t('shortcuts.help')],
  ];
  return (
    <Modal title={t('shortcuts.title')} icon={Keyboard} onClose={onClose}>
      <table className="table">
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={keys}>
              <td style={{ width: 170 }}>
                {keys.split(' + ').map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' + '}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </td>
              <td>{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
