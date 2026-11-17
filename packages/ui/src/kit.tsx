import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Glyph, type GlyphName } from './glyphs';

/*
 * Kit v2 (Phase 13): borderless layered surfaces, status pills, agent status, sheets, popovers
 * and toasts. Styles are at the end of `styles.css` (the `k-` classes).
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export type Tone = 'neutral' | 'brand' | 'positive' | 'negative' | 'warning';

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Outer frame: a header in its padding, content in a `ShellPanel`. */
export function Shell({ className, ...p }: HTMLAttributes<HTMLElement>) {
  return <section className={cx('k-shell', className)} {...p} />;
}

/** The white content area inside a shell. */
export function ShellPanel({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('k-panel', className)} {...p} />;
}

/** One level deeper: payloads, details, code. */
export function Inset({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('k-inset', className)} {...p} />;
}

/** A glyph in a tinted rounded square. */
export function IconTile({ icon, tone = 'neutral', children }: { icon?: GlyphName; tone?: Tone; children?: ReactNode }) {
  return (
    <span className="k-tile" data-tone={tone === 'neutral' ? undefined : tone} aria-hidden="true">
      {icon ? <Glyph name={icon} /> : children}
    </span>
  );
}

/** Header row of a shell: tile, title and subtitle, and an aside (stat, pill or actions). */
export function ShellHeader({
  icon,
  tone,
  title,
  subtitle,
  aside,
  level = 2,
}: {
  icon?: GlyphName;
  tone?: Tone;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  level?: 2 | 3;
}) {
  const H = `h${level}` as const;
  return (
    <div className={cx('k-shead', !icon && 'k-shead-plain')}>
      {icon && <IconTile icon={icon} tone={tone} />}
      <div className="k-shead-text">
        <H>{title}</H>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {aside}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pills, tags, keys, activity
// ---------------------------------------------------------------------------

/** Tinted status: tone is never the only signal, so it always has text. */
export function StatusPill({
  tone = 'neutral',
  icon,
  busy = false,
  size = 'md',
  children,
  title,
}: {
  tone?: Tone;
  icon?: GlyphName;
  /** Animated dots before the text (something is running). */
  busy?: boolean;
  size?: 'sm' | 'md';
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className="k-pill" data-tone={tone === 'neutral' ? undefined : tone} data-size={size === 'sm' ? 'sm' : undefined} title={title}>
      {busy ? <Dots /> : icon ? <Glyph name={icon} size={size === 'sm' ? 11 : 13} /> : null}
      {children}
    </span>
  );
}

export const Tag = ({ children }: { children: ReactNode }) => <span className="k-tag">{children}</span>;
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="k-kbd">{children}</kbd>;

/** Three pulsing dots: the agent is working. */
export const Dots = () => (
  <span className="k-dots" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

export const Spinner = ({ label }: { label?: string }) => (
  <span className="k-spin" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
);

export const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

/** Time since `since` (ms since epoch), ticking once a second. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(now - since)}</span>;
}

/** Striped progress, clipped rather than scaled so the stripes keep their angle. */
export function StripeProgress({ value, label, tone }: { value: number; label: string; tone?: 'positive' | 'warning' }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className="k-stripe"
      data-tone={tone}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <i style={{ clipPath: `inset(0 ${100 - pct}% 0 0 round 999px)` }} />
    </div>
  );
}

/**
 * What the agent is doing right now: dots, the current action, the time since it started, the
 * last few finished steps, and Stop.
 */
export function AgentStatus({
  label,
  since,
  steps = [],
  onStop,
  stopLabel = 'Stop',
}: {
  label: ReactNode;
  since?: number;
  steps?: string[];
  onStop?: () => void;
  stopLabel?: string;
}) {
  return (
    <div className="k-agent" role="status" aria-live="polite">
      <div className="k-agent-row">
        <span className="k-agent-ind">
          <Dots />
        </span>
        <span className="k-agent-label">{label}</span>
        {since !== undefined && (
          <StatusPill icon="clock">
            <Elapsed since={since} />
          </StatusPill>
        )}
        {onStop && (
          <button type="button" className="ui-btn ui-btn-sm ui-btn-danger" onClick={onStop}>
            <Glyph name="stop" size={12} />
            {stopLabel}
          </button>
        )}
      </div>
      {steps.length > 0 && (
        <ol className="k-agent-steps">
          {steps.slice(-3).map((s, i) => (
            <li key={`${i}-${s}`} className="k-enter">
              <Glyph name="check" size={12} />
              {s}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet (modal) and popover
// ---------------------------------------------------------------------------

/** A modal sheet. Escape or a click outside closes it; focus returns where it was. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, textarea, select');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="k-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="k-sheet" role="dialog" aria-modal="true" aria-labelledby={id} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <ShellPanel>
          <div className="k-sheet-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id={id}>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button type="button" className="ui-btn ui-btn-quiet ui-icon-btn ui-btn-sm" aria-label="Close" onClick={onClose}>
              <Glyph name="x" size={14} />
            </button>
          </div>
          {children}
        </ShellPanel>
      </div>
    </div>
  );
}

/**
 * A popover anchored in a `position: relative` wrapper. Closes on Escape and on a pointer down
 * outside the wrapper.
 */
export function Popover({
  open,
  onClose,
  children,
  align = 'end',
  side = 'bottom',
  minWidth,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  minWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const wrap = ref.current?.parentElement;
      if (wrap && !wrap.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className="k-pop"
      style={{
        [align === 'end' ? 'right' : 'left']: 0,
        [side === 'bottom' ? 'top' : 'bottom']: 'calc(100% + 6px)',
        minWidth,
      }}
    >
      <ShellPanel>{children}</ShellPanel>
    </div>
  );
}

export function Menu({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="k-menu" role="menu" aria-label={label}>
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  onSelect,
  disabled,
}: {
  icon?: GlyphName;
  children: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className="k-menu-item" onClick={onSelect} disabled={disabled}>
      {icon && <Glyph name={icon} size={14} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        {children}
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="k-menu-label">{children}</div>;
export const MenuSeparator = () => <hr className="k-menu-sep" />;

// ---------------------------------------------------------------------------
// Toasts and notifications
// ---------------------------------------------------------------------------

export interface ToastOptions {
  /** Shows an Undo button that calls this. */
  undo?: () => void;
  /** A button with its own label. */
  action?: { label: string; run: () => void };
  tone?: 'default' | 'error';
}
interface ToastItem extends ToastOptions {
  id: number;
  message: ReactNode;
}
type ToastFn = (message: ReactNode, options?: ToastOptions) => void;

const ToastContext = createContext<ToastFn>(() => undefined);

/** One stack of toasts per window, bottom right. Errors stay longer (6 s, others 4 s). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastFn>(
    (message, options = {}) => {
      const id = ++next.current;
      setItems((cur) => [...cur.slice(-2), { id, message, ...options }]);
      setTimeout(() => dismiss(id), options.tone === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="k-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="k-toast" data-tone={t.tone === 'error' ? 'error' : undefined} role={t.tone === 'error' ? 'alert' : undefined}>
            <span style={{ flex: 1, minWidth: 0 }}>{t.message}</span>
            {t.undo && (
              <button
                type="button"
                onClick={() => {
                  t.undo?.();
                  dismiss(t.id);
                }}
              >
                Undo
              </button>
            )}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/**
 * A system notification when the window isn't focused (best effort: the webview may not allow
 * it). Returns whether one was shown, so callers can fall back to a toast.
 */
export function notifySystem(title: string, body: string): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (document.hasFocus()) return false;
  try {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return true;
    }
    if (Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    // Not available in this webview.
  }
  return false;
}
