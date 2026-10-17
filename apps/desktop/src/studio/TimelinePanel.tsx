import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { voiceSpans, type OverlayInstance, type Timeline, type TimelinePatch } from '@studio/core';
import { Button, Chip, Eyebrow } from '@studio/ui';
import type { Resolved } from './resolve';
import { OVERLAY_DRAG_TYPE } from './Library';
import { Waveform } from './Waveform';

const LABEL_W = 120;
const LANE_H = 30;
const SNAP = 1 / 30;

type DragMode = 'move' | 'start' | 'end';

interface Props {
  slug: string;
  timeline: Timeline;
  resolved: Resolved;
  t: number;
  onSeek: (t: number) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  patch: (p: TimelinePatch, opts?: { group?: string; label?: string }) => Promise<void>;
  onSplit: () => void;
  /** A library tile dropped on the Overlays lane at output time t. */
  onDropOverlay?: (component: string, t: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Extra toolbar actions (e.g. Regenerate VO). */
  actions?: ReactNode;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/** Greedy row packing so overlapping overlays stack. */
function packRows(items: OverlayInstance[]): Map<string, number> {
  const rows: number[] = [];
  const out = new Map<string, number>();
  for (const o of [...items].sort((a, b) => a.start - b.start)) {
    let r = rows.findIndex((end) => end <= o.start + 1e-6);
    if (r < 0) r = rows.push(0) - 1;
    rows[r] = o.end;
    out.set(o.id, r);
  }
  return out;
}

export function TimelinePanel({
  slug,
  timeline,
  resolved,
  t,
  onSeek,
  selected,
  onSelect,
  patch,
  onSplit,
  onDropOverlay,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  actions,
}: Props) {
  const duration = Math.max(resolved.tm.duration, 1);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{
    id: string;
    mode: DragMode;
    x: number;
    start: number;
    end: number;
    group: string;
  } | null>(null);
  const seeking = useRef(false);
  const dragSeq = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = (Math.max(width - LABEL_W - 16, 200) / duration) * zoom;
  const x = (time: number) => time * pps;
  const trackW = duration * pps;
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 70) ?? 60;
  const ticks = useMemo(
    () => Array.from({ length: Math.floor(duration / tickStep) + 1 }, (_, i) => i * tickStep),
    [duration, tickStep],
  );

  const overlays = timeline.overlays.filter((o) => o.component !== 'core:Zoom');
  const zooms = timeline.overlays.filter((o) => o.component === 'core:Zoom');
  const rows = useMemo(() => packRows(overlays), [overlays]);
  const overlayRows = Math.max(1, ...[...rows.values()].map((r) => r + 1));

  function timeFromPointer(e: ReactPointerEvent | PointerEvent) {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - rect.left - LABEL_W + el.scrollLeft) / pps, 0), duration);
  }

  function startDrag(e: ReactPointerEvent, o: OverlayInstance, mode: DragMode) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    onSelect(o.id);
    drag.current = {
      id: o.id,
      mode,
      x: e.clientX,
      start: o.start,
      end: o.end,
      group: `${mode}-${o.id}-${++dragSeq.current}`,
    };
  }

  function onDragMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dt = Math.round((e.clientX - d.x) / pps / SNAP) * SNAP;
    let start = d.start;
    let end = d.end;
    if (d.mode === 'move') {
      const len = d.end - d.start;
      start = Math.min(Math.max(d.start + dt, 0), duration - len);
      end = start + len;
    } else if (d.mode === 'start') start = Math.min(Math.max(d.start + dt, 0), d.end - 0.2);
    else end = Math.max(Math.min(d.end + dt, duration), d.start + 0.2);
    const i = timeline.overlays.findIndex((o) => o.id === d.id);
    const cur = timeline.overlays[i];
    if (i < 0 || !cur || (Math.abs(cur.start - start) < 1e-4 && Math.abs(cur.end - end) < 1e-4)) return;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    void patch(
      [
        { op: 'replace', path: `/overlays/${i}/start`, value: r(start) },
        { op: 'replace', path: `/overlays/${i}/end`, value: r(end) },
      ],
      { group: d.group, label: d.mode === 'move' ? 'Move overlay' : 'Trim overlay' },
    );
  }

  function block(o: OverlayInstance, top: number, color: { bg: string; border: string; ink: string }) {
    const isSel = o.id === selected;
    return (
      <div
        key={o.id}
        role="button"
        tabIndex={0}
        aria-pressed={isSel}
        aria-label={`${o.component} ${fmt(o.start)} to ${fmt(o.end)}`}
        onPointerDown={(e) => startDrag(e, o, 'move')}
        onPointerMove={onDragMove}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(o.id);
        }}
        title={`${o.component} · ${fmt(o.start)}–${fmt(o.end)}`}
        style={{
          position: 'absolute',
          top,
          height: LANE_H - 8,
          left: x(o.start),
          width: Math.max(x(o.end) - x(o.start), 6),
          background: color.bg,
          border: `${isSel ? 2 : 1}px solid ${isSel ? 'var(--ui-navy)' : color.border}`,
          color: color.ink,
          borderRadius: 6,
          boxSizing: 'border-box',
          fontSize: 11,
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {['start', 'end'].map((m) => (
          <span
            key={m}
            aria-hidden="true"
            onPointerDown={(e) => startDrag(e, o, m as DragMode)}
            onPointerMove={onDragMove}
            onPointerUp={() => (drag.current = null)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 7,
              [m === 'start' ? 'left' : 'right']: 0,
              cursor: 'ew-resize',
            }}
          />
        ))}
        {o.component.replace(/^(core|workspace|project):/, '')}
      </div>
    );
  }

  const lanes: { name: string; swatch: string; height: number; render: () => React.ReactNode }[] = [
    {
      name: 'Scenes',
      swatch: 'var(--ui-orange)',
      height: LANE_H,
      render: () =>
        resolved.tm.segments.map((g) => (
          <div
            key={`${g.sceneId}-${g.index}`}
            title={`${g.segment.kind} · ${fmt(g.start)}–${fmt(g.end)}`}
            style={{
              position: 'absolute',
              top: 4,
              height: LANE_H - 8,
              left: x(g.start),
              width: Math.max(x(g.end) - x(g.start), 2),
              background: g.segment.kind === 'hold' ? '#FFF4E5' : '#E4EAF2',
              border: '1px solid #B9C6D6',
              borderRadius: 6,
              boxSizing: 'border-box',
              fontSize: 11,
              padding: '0 8px',
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              color: 'var(--ui-navy)',
            }}
          >
            {g.segment.kind === 'src'
              ? `Recording · ${g.segment.from.toFixed(1)}–${g.segment.to.toFixed(1)} s`
              : g.segment.kind}
          </div>
        )),
    },
    {
      name: 'Steps',
      swatch: 'var(--ui-steel)',
      height: LANE_H,
      render: () =>
        resolved.steps.map((s, i) => (
          <div
            key={s.id}
            title={s.title}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSeek(s.start);
            }}
            style={{
              position: 'absolute',
              top: 4,
              height: LANE_H - 8,
              left: x(s.start),
              width: Math.max(x(s.end) - x(s.start) - 2, 4),
              background: 'var(--ui-steel-100)',
              border: '1px solid var(--ui-steel-300)',
              borderRadius: 6,
              boxSizing: 'border-box',
              fontSize: 11,
              padding: '0 8px',
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              color: 'var(--ui-navy)',
              cursor: 'pointer',
            }}
          >
            {i + 1} · {s.title}
          </div>
        )),
    },
    {
      name: 'Overlays',
      swatch: 'var(--ui-orange)',
      height: overlayRows * LANE_H,
      render: () =>
        overlays.map((o) =>
          block(
            o,
            4 + (rows.get(o.id) ?? 0) * LANE_H,
            o.author === 'auto'
              ? { bg: 'var(--ui-white)', border: '#B9C6D6', ink: 'var(--ui-navy)' }
              : { bg: 'var(--ui-orange-100)', border: 'var(--ui-orange)', ink: 'var(--ui-orange-ink)' },
          ),
        ),
    },
    {
      name: 'Camera',
      swatch: 'var(--ui-navy)',
      height: LANE_H,
      render: () =>
        zooms.map((o) => block(o, 4, { bg: '#E4EAF2', border: 'var(--ui-navy)', ink: 'var(--ui-navy)' })),
    },
    {
      name: 'Voice-over',
      swatch: 'var(--ui-green)',
      height: LANE_H,
      render: () =>
        timeline.voice.length ? (
          voiceSpans(timeline, resolved.tm).map(({ line, start, end }) => (
            <div
              key={line.id}
              title={`${line.owner}: ${line.text}`}
              style={{
                position: 'absolute',
                top: 4,
                height: LANE_H - 8,
                left: x(start),
                width: x(end - start),
                background: 'var(--ui-green-100)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              {line.audio && <Waveform slug={slug} audio={line.audio} height={LANE_H - 8} />}
            </div>
          ))
        ) : (
          <span style={{ position: 'absolute', left: 8, top: 8, fontSize: 11, color: 'var(--ui-gray-500)' }}>
            No voice-over yet: write narration, then Regenerate VO
          </span>
        ),
    },
    {
      name: 'Captions',
      swatch: 'var(--ui-gray-500)',
      height: LANE_H,
      render: () =>
        timeline.captions.map((c) => (
          <div
            key={c.id}
            style={{
              position: 'absolute',
              top: 4,
              height: LANE_H - 8,
              left: x(c.start),
              width: x(c.end - c.start),
              border: '1px solid var(--ui-gray-300)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 6px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
            }}
          >
            {c.text}
          </div>
        )),
    },
    {
      name: 'Annotations',
      swatch: 'var(--ui-steel)',
      height: LANE_H,
      render: () =>
        timeline.annotations.map((a, i) => (
          <span key={a.id} className="ui-pin" style={{ position: 'absolute', top: 5, left: x(a.t) - 10 }}>
            {i + 1}
          </span>
        )),
    },
  ];

  return (
    <section
      aria-label="Timeline"
      style={{
        background: 'var(--ui-white)',
        borderTop: '1px solid var(--ui-gray-300)',
        padding: '10px 16px 12px 22px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="ui-mono" style={{ fontSize: 18, color: 'var(--ui-navy)' }}>
          {fmt(t)}
        </span>
        <span style={{ width: 1, height: 22, background: 'var(--ui-gray-300)', margin: '0 4px' }} />
        <Button size="sm" onClick={onSplit} title="Split the recording at the playhead (S)">
          Split
        </Button>
        <Button size="sm" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
          Undo
        </Button>
        <Button size="sm" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          Redo
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!selected}
          onClick={() => {
            const i = timeline.overlays.findIndex((o) => o.id === selected);
            if (i >= 0) void patch([{ op: 'remove', path: `/overlays/${i}` }], { label: 'Delete overlay' });
            onSelect(null);
          }}
        >
          Delete
        </Button>
        {actions}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
          Space play · J/L ±1 s · ←/→ frame · S split · ⌫ delete
        </span>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ui-gray-600)' }}
        >
          Zoom
          <input
            type="range"
            min={1}
            max={8}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ width: 100, accentColor: 'var(--ui-orange)' }}
          />
        </label>
        {selected && <Chip tone="active">{`selected: ${selected}`}</Chip>}
      </div>

      <div ref={scroller} style={{ overflowX: 'auto', position: 'relative' }}>
        <div style={{ position: 'relative', width: LABEL_W + trackW + 16 }}>
          {/* ruler: click or drag to seek */}
          <div
            style={{
              position: 'relative',
              height: 20,
              marginLeft: LABEL_W,
              width: trackW,
              cursor: 'pointer',
              touchAction: 'none',
            }}
            onPointerDown={(e) => {
              seeking.current = true;
              (e.target as Element).setPointerCapture(e.pointerId);
              onSeek(timeFromPointer(e));
            }}
            onPointerMove={(e) => seeking.current && onSeek(timeFromPointer(e))}
            onPointerUp={() => (seeking.current = false)}
          >
            {ticks.map((s) => (
              <span
                key={s}
                className="ui-mono"
                style={{
                  position: 'absolute',
                  left: x(s),
                  top: 2,
                  fontSize: 10,
                  color: 'var(--ui-gray-600)',
                  borderLeft: '1px solid var(--ui-gray-300)',
                  paddingLeft: 3,
                }}
              >
                {fmt(s).replace(/\.\d\d$/, '')}
              </span>
            ))}
          </div>
          {lanes.map((lane) => (
            <div key={lane.name} style={{ display: 'flex', marginTop: 4 }}>
              <div
                style={{
                  width: LABEL_W,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  fontWeight: 500,
                  height: lane.height,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: lane.swatch }} />
                <Eyebrow>{lane.name}</Eyebrow>
              </div>
              <div
                style={{
                  position: 'relative',
                  width: trackW,
                  height: lane.height,
                  background: 'var(--ui-gray-50)',
                  borderRadius: 6,
                }}
                onDragOver={(e) => {
                  if (lane.name === 'Overlays' && e.dataTransfer.types.includes(OVERLAY_DRAG_TYPE))
                    e.preventDefault();
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(OVERLAY_DRAG_TYPE);
                  if (lane.name === 'Overlays' && id) {
                    e.preventDefault();
                    onDropOverlay?.(id, timeFromPointer(e as unknown as PointerEvent));
                  }
                }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    onSelect(null);
                    onSeek(timeFromPointer(e));
                  }
                }}
              >
                {lane.render()}
              </div>
            </div>
          ))}
          {/* playhead */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: LABEL_W + x(t) - 1,
              width: 2,
              background: 'var(--ui-navy)',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 0,
                left: -6,
                width: 14,
                height: 12,
                background: 'var(--ui-navy)',
                borderRadius: '3px 3px 7px 7px',
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
