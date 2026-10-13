import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useStore } from '../lib/store';
import { useT } from '../lib/i18n';
import { useLatest } from '../lib/hooks';
import type { Tone } from '../state/app';
import { uiStore } from '../state/ui';
import { Button } from './ui';

interface ModalProps {
  title: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  wide?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}

/** Open modals, innermost last – only the top one reacts to Escape. */
const stack: number[] = [];
let sequence = 0;

/** Modal dialog: closes with Escape or the × button, focuses the first control. */
export function Modal({
  title,
  icon: Icon,
  tone,
  wide,
  onClose,
  footer,
  children,
  testId,
}: ModalProps): ReactNode {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useLatest(onClose);

  useEffect(() => {
    const id = ++sequence;
    stack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea, [data-autofocus]',
    );
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(id), 1);
      previous?.focus?.();
    };
  }, [closeRef]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={['modal', wide && 'wide'].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-testid={testId}
      >
        <div className="modal-head">
          {Icon && (
            <span className="modal-icon" data-tone={tone}>
              <Icon size={18} strokeWidth={2.2} aria-hidden />
            </span>
          )}
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" iconOnly icon={X} onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const TONE_ICONS: Record<Tone, LucideIcon> = {
  info: Info,
  ok: Info,
  warn: TriangleAlert,
  error: CircleAlert,
};

/** Renders queued alert/confirm/choice requests. */
export function ModalHost(): ReactNode {
  const modals = useStore(uiStore, (s) => s.modals);
  const top = modals[modals.length - 1];
  if (!top) return null;
  return (
    <Modal
      key={top.id}
      title={top.title}
      icon={TONE_ICONS[top.tone]}
      tone={top.tone}
      onClose={() => top.resolve(top.cancelValue)}
      testId="message-dialog"
      footer={
        <>
          <span className="spacer" />
          {top.choices.map((c, i) => (
            <Button
              key={i}
              variant={c.variant ?? 'default'}
              data-autofocus={i === top.choices.length - 1 ? true : undefined}
              onClick={() => top.resolve(c.value)}
            >
              {c.label}
            </Button>
          ))}
        </>
      }
    >
      <div className="modal-text">{top.text}</div>
    </Modal>
  );
}

export function Toasts(): ReactNode {
  const toasts = useStore(uiStore, (s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-tone={toast.tone}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
