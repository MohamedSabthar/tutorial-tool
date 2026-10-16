import { useRef, useState, type PointerEvent } from 'react';
import type { Rect } from '@studio/core';
import { DomLayer } from '@studio/stage';

export interface SnapTarget {
  stepId: string;
  title: string;
  rect: Rect;
}

const SNAP_PX = 28;

/** The step box the rect should snap to, if its centre is close to one. */
export function snapTarget(r: Rect, targets: SnapTarget[]): SnapTarget | null {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let best: { t: SnapTarget; d: number } | null = null;
  for (const t of targets) {
    const d = Math.hypot(t.rect.x + t.rect.w / 2 - cx, t.rect.y + t.rect.h / 2 - cy);
    if (d <= SNAP_PX * 3 && (!best || d < best.d)) best = { t, d };
  }
  return best?.t ?? null;
}

/**
 * Editor-only handles for the selected overlay, drawn in the camera-following layer (never
 * exported). Drag to move, drag the corner to resize; dropping near a recorded step target
 * snaps onto it and re-anchors the overlay to that step.
 */
export function Manipulator({
  rect,
  targets,
  onDrag,
  onCommit,
}: {
  rect: Rect;
  targets: SnapTarget[];
  onDrag: (r: Rect | null) => void;
  onCommit: (result: { anchor: string } | { rect: Rect }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; rect: Rect; mode: 'move' | 'resize'; scale: number } | null>(
    null,
  );
  const [live, setLive] = useState<Rect | null>(null);
  const shown = live ?? rect;
  const snap = live ? snapTarget(live, targets) : null;

  function down(e: PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const el = box.current!;
    // Screen px per stage px, including the stage fit and camera zoom.
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
    start.current = { x: e.clientX, y: e.clientY, rect, mode, scale };
  }
  function move(e: PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = (e.clientX - s.x) / s.scale;
    const dy = (e.clientY - s.y) / s.scale;
    const next =
      s.mode === 'move'
        ? { ...s.rect, x: s.rect.x + dx, y: s.rect.y + dy }
        : { ...s.rect, w: Math.max(20, s.rect.w + dx), h: Math.max(14, s.rect.h + dy) };
    setLive(next);
    onDrag(snapTarget(next, targets)?.rect ?? next);
  }
  function up() {
    const s = start.current;
    start.current = null;
    if (!s || !live) return;
    const target = s.mode === 'move' ? snapTarget(live, targets) : null;
    const r = (v: number) => Math.round(v * 10) / 10;
    onCommit(
      target
        ? { anchor: target.stepId }
        : { rect: { x: r(live.x), y: r(live.y), w: r(live.w), h: r(live.h) } },
    );
    setLive(null);
    onDrag(null);
  }

  return (
    <DomLayer follow>
      {live &&
        targets.map((t) => (
          <div
            key={t.stepId}
            style={{
              position: 'absolute',
              left: t.rect.x,
              top: t.rect.y,
              width: t.rect.w,
              height: t.rect.h,
              border: `2px dashed ${snap?.stepId === t.stepId ? '#FF5800' : 'rgba(79,122,163,0.7)'}`,
              borderRadius: 6,
              pointerEvents: 'none',
            }}
          />
        ))}
      <div
        ref={box}
        role="button"
        aria-label="Move the selected overlay"
        onPointerDown={(e) => down(e, 'move')}
        onPointerMove={move}
        onPointerUp={up}
        style={{
          position: 'absolute',
          left: shown.x - 6,
          top: shown.y - 6,
          width: shown.w + 12,
          height: shown.h + 12,
          border: '2px dashed #13213B',
          borderRadius: 8,
          background: 'rgba(19,33,59,0.04)',
          cursor: 'move',
          pointerEvents: 'auto',
          touchAction: 'none',
          boxSizing: 'border-box',
        }}
      >
        {snap && (
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: -30,
              whiteSpace: 'nowrap',
              fontSize: 18,
              fontFamily: 'Inter, sans-serif',
              background: '#FF5800',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 6,
            }}
          >
            Snap to {snap.stepId} · {snap.title}
          </span>
        )}
        <span
          role="button"
          aria-label="Resize the selected overlay"
          onPointerDown={(e) => down(e, 'resize')}
          onPointerMove={move}
          onPointerUp={up}
          style={{
            position: 'absolute',
            right: -9,
            bottom: -9,
            width: 16,
            height: 16,
            background: '#13213B',
            border: '2px solid #fff',
            borderRadius: 4,
            cursor: 'nwse-resize',
          }}
        />
      </div>
    </DomLayer>
  );
}
