import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'violet' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  iconOnly?: boolean;
  wide?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    icon: Icon,
    iconOnly,
    wide,
    className,
    children,
    type,
    ...rest
  },
  ref,
) {
  const classes = [
    'btn',
    variant !== 'default' && `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    iconOnly && 'btn-icon',
    wide && 'btn-wide',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type ?? 'button'} className={classes} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2.2} aria-hidden />}
      {!iconOnly && children}
      {iconOnly && <span className="sr-only">{children}</span>}
    </button>
  );
});

export interface Option<T extends string | number> {
  value: T;
  label: string;
}

interface SelectProps<T extends string | number> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value'
> {
  value: T;
  options: readonly (Option<T> | T)[];
  onChange: (value: T) => void;
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
  ...rest
}: SelectProps<T>): ReactNode {
  const normalized = options.map((o) =>
    typeof o === 'object' ? o : { value: o, label: String(o) },
  );
  return (
    <select
      className={['select', className].filter(Boolean).join(' ')}
      value={String(value)}
      onChange={(e) => {
        const found = normalized.find((o) => String(o.value) === e.target.value);
        if (found) onChange(found.value);
      }}
      {...rest}
    >
      {normalized.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
>(function Input({ className, mono, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={['input', mono && 'mono', className].filter(Boolean).join(' ')}
      spellCheck={false}
      autoComplete="off"
      {...rest}
    />
  );
});

interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

/** Number field that only commits valid values (on blur or Enter). */
export function NumberInput({
  value,
  min,
  max,
  onChange,
  className,
  ...rest
}: NumberInputProps): ReactNode {
  return (
    <input
      type="number"
      className={['input', className].filter(Boolean).join(' ')}
      defaultValue={value}
      key={value}
      min={min}
      max={max}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n) || e.target.value === '') {
          e.target.value = String(value);
          return;
        }
        const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(n)));
        e.target.value = String(clamped);
        if (clamped !== value) onChange(clamped);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      {...rest}
    />
  );
}

interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  switchStyle?: boolean;
  testId?: string;
}

export function Check({
  checked,
  onChange,
  children,
  title,
  disabled,
  switchStyle,
  testId,
}: CheckProps): ReactNode {
  return (
    <label className={switchStyle ? 'switch' : 'check'} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <label className={['field', className].filter(Boolean).join(' ')}>
      <span>{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function Card({
  title,
  icon: Icon,
  actions,
  children,
  fill,
  className,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  className?: string;
}): ReactNode {
  return (
    <section className={['card', fill && 'card-fill', className].filter(Boolean).join(' ')}>
      {title && (
        <div className="card-title">
          {Icon && <Icon size={14} strokeWidth={2.4} aria-hidden />}
          <span className="grow">{title}</span>
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <header className="page-header">
      <div className="grow">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}

export function Empty({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="list-empty">
      <Icon size={30} strokeWidth={1.6} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
