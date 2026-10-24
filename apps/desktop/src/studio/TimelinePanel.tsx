import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  cutGaps,
  voiceOverlaps,
  voiceSpans,
  type OverlayInstance,
  type Timeline,
  type TimelinePatch,
} from '@studio/core';
import { Button, Chip, Eyebrow } from '@studio/ui';
import { Timed, type Player } from '@studio/stage';
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
  /** The playhead follows it (only the timecode and the playhead re-render as it plays). */
  player: Player;
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
  /** An annotation pin on the lane was clicked. */
  onAnnotation?: (id: string) => void;
  /** Remove an explainer scene (× on its block). */
  onRemoveScene?: (sceneId: string) => void;
  /** An explainer block was clicked. */
  onSelectScene?: (sceneId: string) => void;
  /** Set (component and duration) or remove (null) the transition between two scenes. */
  onTransition?: (between: [string, string], value: { component: string; duration: number } | null) => void;
  /** The recording piece selected for editing (scene and segment index). */
  selectedPiece?: PieceRef | null;
  onSelectPiece?: (piece: PieceRef | null) => void;
  /** The cut after piece `after` of a scene is clicked: put the recording back. */
  onRestoreCut?: (sceneId: string, after: number) => void;
  /** The voice line selected for editing. */
  selectedLine?: string | null;
  onSelectLine?: (id: string | null) => void;
  /** A voice line dragged to start at output time `at`. */
  onMoveLine?: (id: string, at: number) => void;
}

/** A piece (segment) of a recording scene. */
export interface PieceRef {
  sceneId: string;
  index: number;
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
  player,
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
  onAnnotation,
  onRemoveScene,
  onSelectScene,
  onTransition,
  selectedPiece,
  onSelectPiece,
  onRestoreCut,
  selectedLine,
  onSelectLine,
  onMoveLine,
}: Props) {
  // A voice line being dragged along its lane: where the drag began, and how far it has moved.
  const lineDragStart = useRef<{ id: string; x: number; start: number } | null>(null);
  const [lineDrag, setLineDrag] = useState<{ id: string; dt: number } | null>(null);
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

  const lineSpans = useMemo(() => voiceSpans(timeline, resolved.tm), [timeline, resolved]);
  const lineOverlaps = useMemo(() => voiceOverlaps(lineSpans), [lineSpans]);
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
      render: () => [
        ...resolved.tm.scenes
          .filter((sc) => sc.kind === 'explainer')
          .map((sc) => {
            const scene = timeline.scenes.find((x) => x.id === sc.sceneId);
            const name = scene?.kind === 'explainer' ? scene.component.split(':')[1] : sc.sceneId;
            return (
              <div
                key={sc.sceneId}
                role="button"
                tabIndex={0}
                aria-label={`Explainer ${name}`}
                onClick={() => onSelectScene?.(sc.sceneId)}
                onKeyDown={(e) => e.key === 'Enter' && onSelectScene?.(sc.sceneId)}
                title={`Explainer ${name} · ${fmt(sc.start)}–${fmt(sc.end)}`}
                style={{
                  position: 'absolute',
                  top: 4,
                  height: LANE_H - 8,
                  left: x(sc.start),
                  width: Math.max(x(sc.end) - x(sc.start), 2),
                  background: 'var(--ui-orange-100)',
                  border: '1.5px solid var(--ui-orange)',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  fontSize: 11,
                  padding: '0 4px 0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  color: 'var(--ui-orange-ink)',
                  fontWeight: 600,
                  zIndex: 1,
                  cursor: 'pointer',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                  Explainer · {name}
                </span>
                {onRemoveScene && (
                  <button
                    type="button"
                    aria-label={`Remove explainer ${name}`}
                    title="Remove this explainer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveScene(sc.sceneId);
                    }}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: 'inherit',
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: '0 4px',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          }),
        ...timeline.scenes.slice(1).map((sc, i) => {
          const prev = timeline.scenes[i]!;
          const span = resolved.tm.scenes.find((x) => x.sceneId === sc.id);
          if (!span) return null;
          const tr = timeline.transitions.find((x) => x.between[0] === prev.id && x.between[1] === sc.id);
          return (
            <TransitionControl
              key={`tr-${prev.id}-${sc.id}`}
              left={x(span.start) + (tr ? x(tr.duration) / 2 : 0)}
              top={LANE_H / 2}
              transition={tr ? { component: tr.component, duration: tr.duration } : null}
              onChange={(v) => onTransition?.([prev.id, sc.id], v)}
            />
          );
        }),
        ...resolved.tm.segments.map((g) => {
          const seg = g.segment;
          const on = selectedPiece?.sceneId === g.sceneId && selectedPiece.index === g.index;
          const label =
            seg.kind === 'hold'
              ? `Freeze ${seg.duration.toFixed(1)} s`
              : seg.kind === 'speed'
                ? `${seg.rate}× · ${seg.from.toFixed(1)}–${seg.to.toFixed(1)} s`
                : `Recording · ${seg.from.toFixed(1)}–${seg.to.toFixed(1)} s`;
          return (
            <button
              type="button"
              key={`${g.sceneId}-${g.index}`}
              className="timeline-piece"
              data-kind={seg.kind}
              data-manual={seg.manual ? '' : undefined}
              aria-pressed={on}
              aria-label={`${label}${seg.manual ? ', edited by hand' : ''}. Select to edit`}
              title={`${label}${seg.manual ? ' · edited by hand' : ''} · ${fmt(g.start)}–${fmt(g.end)}`}
              onClick={() => onSelectPiece?.(on ? null : { sceneId: g.sceneId, index: g.index })}
              style={{ left: x(g.start), width: Math.max(x(g.end) - x(g.start), 2), height: LANE_H - 8 }}
            >
              {label}
            </button>
          );
        }),
        // Recording cut out between two pieces: a mark that puts it back.
        ...timeline.scenes.flatMap((sc) =>
          sc.kind !== 'recording'
            ? []
            : cutGaps(sc.segments).flatMap((gap) => {
                const span = resolved.tm.segments.find((g) => g.sceneId === sc.id && g.index === gap.after);
                if (!span) return [];
                const what = `${gap.from.toFixed(1)}–${gap.to.toFixed(1)} s`;
                return [
                  <button
                    type="button"
                    key={`cut-${sc.id}-${gap.after}`}
                    className="timeline-cut"
                    aria-label={`Restore the cut recording ${what}`}
                    title={`Cut: ${what} of the recording. Click to put it back.`}
                    onClick={() => onRestoreCut?.(sc.id, gap.after)}
                    style={{ left: x(span.end) }}
                  />,
                ];
              }),
        ),
      ],
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
              ? { bg: 'var(--ui-white)', border: 'var(--ui-steel-300)', ink: 'var(--ui-navy)' }
              : { bg: 'var(--ui-orange-100)', border: 'var(--ui-orange)', ink: 'var(--ui-orange-ink)' },
          ),
        ),
    },
    {
      name: 'Camera',
      swatch: 'var(--ui-navy)',
      height: LANE_H,
      render: () =>
        zooms.map((o) =>
          block(o, 4, { bg: 'var(--ui-steel-100)', border: 'var(--ui-navy)', ink: 'var(--ui-navy)' }),
        ),
    },
    {
      name: 'Voice-over',
      swatch: 'var(--ui-green)',
      height: LANE_H,
      render: () =>
        timeline.voice.length ? (
          lineSpans.map(({ line, start, end }) => {
            const shift = lineDrag?.id === line.id ? lineDrag.dt : 0;
            const over = lineOverlaps.get(line.id);
            return (
              <button
                type="button"
                key={line.id}
                className="timeline-line"
                data-manual={line.manual ? '' : undefined}
                data-overlap={over ? '' : undefined}
                aria-pressed={selectedLine === line.id}
                aria-label={`Voice line${line.manual ? ' (hand-written)' : ''}${over ? ', plays over another line' : ''}: ${line.text}. Select to edit, drag to move`}
                title={`${over ? '⚠ Plays over another line. ' : ''}${line.manual ? 'Hand-written' : line.owner}: ${line.text}`}
                style={{ left: x(Math.max(0, start + shift)), width: x(end - start), height: LANE_H - 8 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  lineDragStart.current = { id: line.id, x: e.clientX, start };
                }}
                onPointerMove={(e) => {
                  const d = lineDragStart.current;
                  if (!d || d.id !== line.id || Math.abs(e.clientX - d.x) < 3) return;
                  setLineDrag({ id: line.id, dt: Math.round((e.clientX - d.x) / pps / SNAP) * SNAP });
                }}
                onPointerUp={() => {
                  const d = lineDragStart.current;
                  lineDragStart.current = null;
                  const dragged = lineDrag?.id === line.id ? lineDrag.dt : 0;
                  setLineDrag(null);
                  if (!d) return;
                  if (dragged !== 0) onMoveLine?.(line.id, Math.max(0, d.start + dragged));
                  else onSelectLine?.(selectedLine === line.id ? null : line.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectLine?.(selectedLine === line.id ? null : line.id);
                  }
                }}
              >
                {line.audio && <Waveform slug={slug} audio={line.audio} height={LANE_H - 8} />}
              </button>
            );
          })
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
        timeline.captions.length ? (
          timeline.captions.map((c, i) => (
            <CaptionCue
              key={c.id}
              text={c.text}
              edited={!!c.edited}
              left={x(c.start)}
              width={x(c.end - c.start)}
              height={LANE_H - 8}
              onSeek={() => onSeek(c.start + 0.01)}
              onSave={(text) =>
                void patch(
                  [
                    { op: 'replace', path: `/captions/${i}/text`, value: text },
                    { op: 'add', path: `/captions/${i}/edited`, value: true },
                  ],
                  { label: 'Edit caption' },
                )
              }
            />
          ))
        ) : (
          <span style={{ position: 'absolute', left: 8, top: 8, fontSize: 11, color: 'var(--ui-gray-500)' }}>
            Built from the voice-over
          </span>
        ),
    },
    {
      name: 'Annotations',
      swatch: 'var(--ui-steel)',
      height: LANE_H,
      render: () =>
        timeline.annotations.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className="ui-pin"
            data-resolved={a.status === 'resolved' || undefined}
            aria-label={`Annotation ${i + 1}${a.comment ? `: ${a.comment}` : ''}`}
            title={a.comment || `Annotation ${i + 1}`}
            onClick={() => onAnnotation?.(a.id)}
            style={{
              position: 'absolute',
              top: 5,
              left: x(a.t) - 10,
              border: 0,
              padding: 0,
              cursor: 'pointer',
            }}
          >
            {i + 1}
          </button>
        )),
    },
  ];

  return (
    <section
      aria-label="Timeline"
      style={{
        background: 'var(--ui-white)',
        padding: '10px 16px 8px 22px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="ui-mono" style={{ fontSize: 18, color: 'var(--ui-navy)' }}>
          <Timed player={player}>{(t) => fmt(t)}</Timed>
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
        <span
          tabIndex={0}
          className="timeline-keys"
          title="Space play · J/L ±1 s · ←/→ frame · S split · ⌫ delete"
          aria-label="Keyboard shortcuts: Space play, J and L one second, arrows one frame, S split, Delete removes"
        >
          Shortcuts
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

      {/* Lanes scroll inside the docked panel, both ways. */}
      <div ref={scroller} style={{ overflow: 'auto', position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
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
          {/* playhead (follows the player on its own) */}
          <Timed player={player}>
            {(t) => (
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
            )}
          </Timed>
        </div>
      </div>
    </section>
  );
}

/**
 * One caption cue on the lane. Click seeks to it; double-click (or Enter when focused) edits
 * the text in place: Enter saves, Shift+Enter adds the second line, Escape cancels.
 */
function CaptionCue({
  text,
  edited,
  left,
  width,
  height,
  onSeek,
  onSave,
}: {
  text: string;
  edited: boolean;
  left: number;
  width: number;
  height: number;
  onSeek: () => void;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const box = {
    position: 'absolute' as const,
    top: 4,
    left,
    width: Math.max(width, 24),
    height,
    borderRadius: 4,
    fontSize: 10,
    boxSizing: 'border-box' as const,
  };
  if (draft !== null)
    return (
      <textarea
        aria-label="Caption text"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') setDraft(null);
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const t = draft.trim();
            if (t && t !== text) onSave(t);
            setDraft(null);
          }
        }}
        style={{
          ...box,
          zIndex: 5,
          minWidth: 220,
          height: 52,
          top: -12,
          padding: '4px 6px',
          border: '1px solid var(--ui-orange)',
          fontFamily: 'inherit',
          resize: 'none',
        }}
      />
    );
  return (
    <button
      type="button"
      title={`${text}${edited ? ' (edited)' : ''} · double-click to edit`}
      onClick={onSeek}
      onDoubleClick={() => setDraft(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(text);
        }
      }}
      style={{
        ...box,
        border: `1px solid ${edited ? 'var(--ui-steel)' : 'var(--ui-gray-300)'}`,
        background: 'var(--ui-white)',
        color: 'var(--ui-ink)',
        padding: '2px 6px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      {text.replace('\n', ' ')}
    </button>
  );
}

const TRANSITIONS = [
  ['core:FreezeMorph', 'FreezeMorph', 1],
  ['core:Crossfade', 'Crossfade', 0.6],
  ['core:Push', 'Push', 0.7],
  ['core:ZoomThrough', 'ZoomThrough', 0.8],
] as const;

/** A scene boundary on the Scenes lane: "+" to add a transition, a diamond to change or remove it. */
function TransitionControl({
  left,
  top,
  transition,
  onChange,
}: {
  left: number;
  top: number;
  transition: { component: string; duration: number } | null;
  onChange: (v: { component: string; duration: number } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [component, setComponent] = useState(transition?.component ?? 'core:FreezeMorph');
  const [duration, setDuration] = useState(transition?.duration ?? 1);
  const name = transition?.component.split(':')[1];
  return (
    <span style={{ position: 'absolute', left, top, zIndex: 3 }}>
      <button
        type="button"
        aria-label={transition ? `Transition ${name}: change` : 'Add a transition here'}
        title={transition ? `${name} · ${transition.duration} s (click to change)` : 'Add a transition here'}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'absolute',
          left: -8,
          top: -8,
          width: 16,
          height: 16,
          padding: 0,
          border: '2px solid var(--ui-white)',
          borderRadius: transition ? 2 : '50%',
          transform: transition ? 'rotate(45deg)' : undefined,
          background: transition ? 'var(--ui-navy)' : 'var(--ui-gray-300)',
          color: 'var(--ui-navy)',
          fontSize: 11,
          lineHeight: '12px',
          cursor: 'pointer',
        }}
      >
        {transition ? '' : '+'}
      </button>
      {open && (
        <span
          role="dialog"
          aria-label="Transition"
          style={{
            position: 'absolute',
            left: 12,
            top: 12,
            width: 220,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: 'var(--ui-white)',
            border: '1px solid var(--ui-gray-300)',
            borderRadius: 10,
            boxShadow: 'var(--ui-shadow-md)',
          }}
        >
          <select
            aria-label="Transition type"
            className="ui-select"
            value={component}
            onChange={(e) => {
              setComponent(e.target.value);
              setDuration(TRANSITIONS.find((x) => x[0] === e.target.value)?.[2] ?? 0.8);
            }}
          >
            {TRANSITIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            Seconds
            <input
              type="number"
              className="ui-input"
              min={0.2}
              max={3}
              step={0.1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </label>
          <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {transition && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Remove
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onChange({ component, duration: Math.min(3, Math.max(0.2, duration)) });
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </span>
        </span>
      )}
    </span>
  );
}
