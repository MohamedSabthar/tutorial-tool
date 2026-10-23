import {
  useId,
  useState,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { IconChevron, IconProjects, IconStudio, IconLive, IconLibrary, IconSettings } from './icons';
import markUrl from '../assets/mark-wso2-orange.png';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Brand marks and type
// ---------------------------------------------------------------------------

/** The orange gradient strip on the left edge. Its parent needs `position: relative`. */
export const EdgeAccent = () => <span aria-hidden="true" className="ui-edge" />;

/** The 2px orange rule under headings. */
export const Rule = ({ width = 48 }: { width?: number }) => (
  <span aria-hidden="true" className="ui-rule" style={{ width }} />
);

export const Eyebrow = ({ children }: { children: ReactNode }) => <span className="ui-eyebrow">{children}</span>;

/** Bold navy heading with the brand's closing orange period and the orange rule. */
export function Title({
  children,
  level = 1,
  size = 30,
  rule = true,
  dot = true,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
  size?: number;
  rule?: boolean;
  dot?: boolean;
}) {
  const H = `h${level}` as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <H className="ui-title" style={{ fontSize: size }}>
        {children}
        {dot && <span className="ui-title-dot">.</span>}
      </H>
      {rule && <Rule />}
    </div>
  );
}

export const Logo = ({ size = 22 }: { size?: number }) => (
  <img src={markUrl} alt="WSO2" width={size} height={size} style={{ display: 'block' }} />
);

// ---------------------------------------------------------------------------
// Header and navigation
// ---------------------------------------------------------------------------

export type NavKey = 'projects' | 'studio' | 'live' | 'library' | 'settings';

const navItems: { key: NavKey; label: string; Icon: typeof IconProjects }[] = [
  { key: 'projects', label: 'Projects', Icon: IconProjects },
  { key: 'studio', label: 'Studio', Icon: IconStudio },
  { key: 'live', label: 'Live', Icon: IconLive },
  { key: 'library', label: 'Library', Icon: IconLibrary },
  { key: 'settings', label: 'Settings', Icon: IconSettings },
];

export function AppHeader({
  title = 'Tutorial Studio',
  current,
  hrefs,
  onNavigate,
  center,
  actions,
}: {
  title?: string;
  current?: NavKey;
  hrefs?: Partial<Record<NavKey, string>>;
  onNavigate?: (key: NavKey) => void;
  center?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-header">
      <span className="ui-header-brand">
        <Logo />
        {title}
      </span>
      {(hrefs || onNavigate) && (
        <nav aria-label="Main" className="ui-nav">
          {navItems.map(({ key, label, Icon }) =>
            // With links, only the screens that have one: a button that does nothing is a dead end.
            hrefs && !onNavigate && !hrefs[key] ? null : hrefs?.[key] ? (
              <a
                key={key}
                href={hrefs[key]}
                aria-label={label}
                title={label}
                aria-current={current === key ? 'page' : undefined}
                className="ui-nav-item"
              >
                <Icon />
              </a>
            ) : (
              <button
                key={key}
                type="button"
                aria-label={label}
                title={label}
                aria-current={current === key ? 'page' : undefined}
                className="ui-nav-item"
                onClick={() => onNavigate?.(key)}
              >
                <Icon />
              </button>
            ),
          )}
        </nav>
      )}
      <div className="ui-header-center">{center}</div>
      {actions}
    </header>
  );
}

/** Context pill: `<Pill items={[<strong>Title</strong>, 'run #8', 'Saved']} />` */
export function Pill({ items }: { items: ReactNode[] }) {
  return (
    <span className="ui-pill">
      {items.map((it, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span aria-hidden="true">|</span>}
          <span>{it}</span>
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export function Panel({
  title,
  action,
  children,
  tone = 'light',
  flush = false,
  className,
  style,
  label,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  tone?: 'light' | 'dark';
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cx('ui-panel', tone === 'dark' && 'ui-panel-dark', flush && 'ui-panel-flush', className)}
      style={style}
    >
      {(title || action) && (
        <div className="ui-panel-head">
          {title && <h2 className="ui-panel-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'steel';
type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      className={cx('ui-btn', variant !== 'secondary' && `ui-btn-${variant}`, size !== 'md' && `ui-btn-${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <a
      className={cx('ui-btn', variant !== 'secondary' && `ui-btn-${variant}`, size !== 'md' && `ui-btn-${size}`, className)}
      {...rest}
    >
      {children}
    </a>
  );
}

export function IconButton({
  label,
  children,
  variant = 'secondary',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ButtonVariant }) {
  return (
    <Button variant={variant} className="ui-icon-btn" aria-label={label} title={label} {...rest}>
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  block = false,
  disabled = false,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode }[] | readonly T[];
  value: T;
  onChange: (v: T) => void;
  block?: boolean;
  disabled?: boolean;
}) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o as T, label: o } : o));
  return (
    <div role="group" aria-label={label} className={cx('ui-seg', block && 'ui-seg-block')}>
      {items.map((o) => (
        <button
          key={o.value}
          type="button"
          className="ui-seg-item"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips, pins, steppers, banners
// ---------------------------------------------------------------------------

export type ChipTone = 'neutral' | 'ok' | 'active' | 'info' | 'error';

export function Chip({
  tone = 'neutral',
  dot = false,
  mono = false,
  children,
  title,
}: {
  tone?: ChipTone;
  dot?: boolean;
  mono?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx('ui-chip', tone !== 'neutral' && `ui-chip-${tone}`, dot && 'ui-chip-dot', mono && 'ui-mono')} title={title}>
      {children}
    </span>
  );
}

/** Teardrop annotation pin. */
export const Pin = ({ n, resolved = false }: { n: ReactNode; resolved?: boolean }) => (
  <span className={cx('ui-pin', resolved && 'ui-pin-resolved')}>{n}</span>
);

export type StepState = 'done' | 'active' | 'todo' | 'gate' | 'failed';

export interface StepperStep {
  label: ReactNode;
  sub?: ReactNode;
  state: StepState;
  /** Shown in the dot instead of the step's number; the dot's colour still gives the state. */
  icon?: ReactNode;
  /** Identifies the step across renders (which steps are open); defaults to the label. */
  id?: string;
}

/**
 * Steps in order. With `collapsible`, each step's detail (`sub`) is hidden until its row is
 * opened; all start closed.
 */
export function Stepper({ steps, collapsible = false }: { steps: StepperStep[]; collapsible?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  let n = 0;
  return (
    <ol className="ui-stepper">
      {steps.map((s, i) => {
        if (s.state !== 'gate') n++;
        const key = s.id ?? (typeof s.label === 'string' ? s.label : String(i));
        const mark = s.icon ?? (s.state === 'done' ? '✓' : s.state === 'gate' ? '◆' : s.state === 'failed' ? '!' : String(n));
        const badge = s.icon && (s.state === 'done' || s.state === 'failed') ? (s.state === 'done' ? '✓' : '!') : null;
        const dot = (
          <span className="ui-step-dot" aria-hidden="true">
            {mark}
            {badge && <span className="ui-step-badge">{badge}</span>}
          </span>
        );
        const expandable = collapsible && !!s.sub;
        const isOpen = expandable && open.has(key);
        const status = { done: 'done', active: 'in progress', todo: 'not started', gate: 'waiting for you', failed: 'failed' }[s.state];
        return (
          <li key={key} className="ui-step" data-state={s.state} aria-current={s.state === 'active' ? 'step' : undefined}>
            {expandable ? (
              <>
                <button
                  type="button"
                  className="ui-step-head"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((cur) => {
                      const next = new Set(cur);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  {dot}
                  <span className="ui-step-title">{s.label}</span>
                  <span className="ui-sr-only">, {status}</span>
                  <IconChevron size={14} className="ui-step-chevron" />
                </button>
                {isOpen && <span className="ui-step-sub ui-step-detail">{s.sub}</span>}
              </>
            ) : (
              <span className="ui-step-head">
                {dot}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span className="ui-step-title">{s.label}</span>
                  {!collapsible && s.sub && <span className="ui-step-sub">{s.sub}</span>}
                </span>
                <span className="ui-sr-only">, {status}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function GateBanner({ title, text, actions }: { title: ReactNode; text?: ReactNode; actions?: ReactNode }) {
  return (
    <div role="status" className="ui-gate">
      <span className="ui-gate-icon" aria-hidden="true">
        ◆
      </span>
      <div className="ui-gate-body">
        <span className="ui-gate-title">{title}</span>
        {text && (
          <span className="ui-gate-text" title={typeof text === 'string' ? text : undefined}>
            {text}
          </span>
        )}
      </div>
      {actions && <div className="ui-gate-actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Receives the generated id so the control is labelled. */
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="ui-field-hint">{hint}</span>}
    </div>
  );
}

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cx('ui-input', className)} {...p} />
);
export const TextArea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx('ui-textarea', className)} {...p} />
);
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cx('ui-select', className)} {...p} />
);

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="ui-switch">
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export const MonoBox = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <pre className="ui-monobox" style={style}>
    {children}
  </pre>
);

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="ui-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
