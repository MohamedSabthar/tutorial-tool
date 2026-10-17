import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Annotation, Rect } from '@studio/core';
import { Panel } from '@studio/ui';
import type { Tool } from './ToolRail';

/** The composition the preview shows (annotation shapes are in its pixels, as seen at `t`). */
const W = 1920;
const H = 1080;
/** Annotations show from this long before their time to this long after. */
const NEAR = 0.6;

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export type Shape = Annotation['shape'];

/**
 * Drawn over the preview, outside the composition, so annotations never reach an export.
 * With an annotation tool it turns clicks into pins and drags into regions; with T/Z/B it hands
 * the point or area to `onArea`. With Select it only shows the pins near the playhead.
 */
export function AnnotationLayer({
  annotations,
  t,
  tool,
  show,
  selected,
  onSelect,
  onCreate,
  onArea,
  popover,
}: {
  annotations: Annotation[];
  t: number;
  tool: Tool;
  show: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (shape: Shape) => void;
  onArea: (tool: 'text' | 'zoom' | 'blur', area: Rect) => void;
  /** The popover for the selected annotation, given where to place it. */
  popover: (a: Annotation, style: CSSProperties) => ReactNode;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const drawing = tool !== 'select';

  const toStage = (e: React.PointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max(((e.clientX - r.left) / r.width) * W, 0), W)),
      y: Math.round(Math.min(Math.max(((e.clientY - r.top) / r.height) * H, 0), H)),
    };
  };
  const finish = (a: { x0: number; y0: number; x: number; y: number }) => {
    const rect = {
      x: Math.min(a.x0, a.x),
      y: Math.min(a.y0, a.y),
      w: Math.abs(a.x - a.x0),
      h: Math.abs(a.y - a.y0),
    };
    const isClick = rect.w < 12 && rect.h < 12;
    if (tool === 'pin' || (tool === 'region' && isClick)) onCreate({ kind: 'point', x: a.x0, y: a.y0 });
    else if (tool === 'region') onCreate({ kind: 'rect', ...rect });
    else if (tool === 'text') onArea('text', { x: a.x0, y: a.y0, w: 0, h: 0 });
    else if ((tool === 'zoom' || tool === 'blur') && !isClick) onArea(tool, rect);
  };

  const numbered = annotations.map((a, i) => ({ a, n: i + 1 }));
  const visible = show
    ? numbered.filter(({ a }) => a.id === selected || (t >= a.t - NEAR && t <= a.t + NEAR))
    : numbered.filter(({ a }) => a.id === selected);
  const sel = numbered.find(({ a }) => a.id === selected);

  return (
    <div
      ref={layer}
      className="annotation-layer"
      data-drawing={drawing ? tool : undefined}
      onPointerDown={(e) => {
        if (!drawing || e.button !== 0) return;
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        const p = toStage(e);
        setDrag({ x0: p.x, y0: p.y, x: p.x, y: p.y });
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, ...toStage(e) })}
      onPointerUp={() => {
        if (drag) finish(drag);
        setDrag(null);
      }}
    >
      {visible.map(({ a, n }) => (
        <AnnotationMark key={a.id} a={a} n={n} active={a.id === selected} onClick={() => onSelect(a.id)} />
      ))}
      {drag && (tool === 'region' || tool === 'zoom' || tool === 'blur') && (
        <span
          className="annotation-draft"
          data-tool={tool}
          style={{
            left: pct(Math.min(drag.x0, drag.x), W),
            top: pct(Math.min(drag.y0, drag.y), H),
            width: pct(Math.abs(drag.x - drag.x0), W),
            height: pct(Math.abs(drag.y - drag.y0), H),
          }}
        />
      )}
      {sel && popover(sel.a, popoverPlace(sel.a.shape))}
    </div>
  );
}

function anchorPoint(s: Shape) {
  return s.kind === 'point' ? { x: s.x, y: s.y } : { x: s.x + s.w, y: s.y };
}

/** Beside the pin (or the region's top-right corner), flipped left near the right edge. */
function popoverPlace(s: Shape): CSSProperties {
  const p = anchorPoint(s);
  const top = `clamp(8px, calc(${pct(p.y, H)} - 20px), calc(100% - 210px))`;
  return p.x > W * 0.6
    ? { right: `calc(${pct(W - p.x, W)} + 28px)`, top }
    : { left: `calc(${pct(p.x, W)} + 28px)`, top };
}

function AnnotationMark({
  a,
  n,
  active,
  onClick,
}: {
  a: Annotation;
  n: number;
  active: boolean;
  onClick: () => void;
}) {
  const p = anchorPoint(a.shape);
  const resolved = a.status === 'resolved';
  return (
    <>
      {a.shape.kind === 'rect' && (
        <span
          className="annotation-region"
          data-resolved={resolved || undefined}
          data-active={active || undefined}
          style={{
            left: pct(a.shape.x, W),
            top: pct(a.shape.y, H),
            width: pct(a.shape.w, W),
            height: pct(a.shape.h, H),
          }}
        />
      )}
      <button
        type="button"
        className="ui-pin annotation-pin"
        data-resolved={resolved || undefined}
        data-active={active || undefined}
        aria-label={`Annotation ${n}${a.comment ? `: ${a.comment}` : ''}`}
        title={a.comment || `Annotation ${n}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClick}
        style={{ left: pct(p.x, W), top: pct(p.y, H) }}
      >
        {n}
      </button>
    </>
  );
}

/** The left-column list: open first, then resolved; click to jump to one. */
export function AnnotationsPanel({
  annotations,
  stepLabel,
  selected,
  onOpen,
  actions,
}: {
  annotations: Annotation[];
  stepLabel: (t: number) => string | null;
  selected: string | null;
  onOpen: (a: Annotation) => void;
  actions?: ReactNode;
}) {
  const numbered = annotations.map((a, i) => ({ a, n: i + 1 }));
  const open = numbered.filter(({ a }) => a.status !== 'resolved');
  const done = numbered.filter(({ a }) => a.status === 'resolved');
  return (
    <Panel
      title="Annotations"
      action={
        <span style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
          {open.length} open · {done.length} resolved
        </span>
      }
    >
      {annotations.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--ui-gray-600)', lineHeight: 1.45 }}>
          Press P and click the preview to pin a note, or R and drag to mark an area. Notes stay out of the
          export.
        </span>
      ) : (
        <ol className="annotation-list">
          {[...open, ...done].map(({ a, n }) => {
            const step = stepLabel(a.t);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className="annotation-item"
                  data-resolved={a.status === 'resolved' || undefined}
                  aria-current={a.id === selected || undefined}
                  onClick={() => onOpen(a)}
                >
                  <span className="ui-pin" data-resolved={a.status === 'resolved' || undefined}>
                    {n}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span className="ui-mono annotation-item-meta">
                      {fmt(a.t)}
                      {step ? ` · ${step}` : ''}
                      {a.status === 'sent' ? ' · sent' : ''}
                    </span>
                    <span className="annotation-item-text">{a.comment || 'No text yet'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {actions}
    </Panel>
  );
}
