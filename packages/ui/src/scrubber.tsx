import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/**
 * A timeline scrubber: lanes are drawn as children, and the playhead (line + handle) is
 * positioned on the same horizontal scale, so the handle always lines up with the content.
 * Drag anywhere on the area, or use the keyboard (arrows ±step, Shift ±1 s, Home/End).
 */
export function Scrubber({
  value,
  max,
  onChange,
  label,
  step = 0.1,
  height,
  children,
  format = (t) => t.toFixed(2),
}: {
  value: number;
  max: number;
  onChange: (t: number) => void;
  label: string;
  step?: number;
  height?: number;
  children?: ReactNode;
  format?: (t: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const clamp = (t: number) => Math.min(Math.max(t, 0), max);
  const pct = max > 0 ? (clamp(value) / max) * 100 : 0;

  function fromPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    onChange(clamp((x / rect.width) * max));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const big = e.shiftKey ? 1 : step;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? value + big
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? value - big
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? max
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next));
  }

  return (
    <div
      ref={ref}
      className="ui-scrubber"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      style={height ? { height } : undefined}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
      }}
      onKeyDown={onKeyDown}
    >
      {children}
      <span aria-hidden="true" className="ui-playhead" style={{ left: `${pct}%` }}>
        <span className="ui-playhead-handle" />
      </span>
    </div>
  );
}
