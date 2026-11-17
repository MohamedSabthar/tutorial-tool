import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShellPanel } from '@studio/ui';

const GAP = 6;
const EDGE = 12;

/**
 * The kit popover, but placed on the page next to its trigger, so a scrolling panel or the
 * timeline's clipped track doesn't cut it off. Opens below the trigger (above when there's no
 * room), focuses its first control, and closes on Escape (focus goes back to the trigger) or a
 * pointer down outside it and the trigger.
 */
export function FloatPopover({
  anchor,
  open,
  onClose,
  children,
  minWidth = 240,
  label,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  minWidth?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth ?? minWidth;
      const h = el?.scrollHeight ?? 300;
      const below = window.innerHeight - a.bottom - GAP - EDGE;
      const above = a.top - GAP - EDGE;
      const down = below >= Math.min(h, 320) || below >= above;
      const maxHeight = Math.max(160, down ? below : above);
      const left = Math.min(Math.max(EDGE, a.left), window.innerWidth - w - EDGE);
      const top = down ? a.bottom + GAP : Math.max(EDGE, a.top - GAP - Math.min(h, maxHeight));
      setPos({ left, top, maxHeight });
    };
    place();
    // Once more after the content has its size.
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, minWidth]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(
      () => ref.current?.querySelector<HTMLElement>('[role="menuitem"], button, input, textarea, select')?.focus(),
      0,
    );
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (ref.current?.contains(n) || anchor?.contains(n)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
      anchor?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor]);

  if (!open || !anchor) return null;
  // `pos` from an earlier opening is only a starting point: the layout effect places it again.
  return createPortal(
    <div
      ref={ref}
      className="k-pop ed-float"
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        minWidth,
        maxHeight: pos?.maxHeight,
      }}
    >
      <ShellPanel>{children}</ShellPanel>
    </div>,
    document.body,
  );
}
