import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { OverlayInstance, Segment, VoiceLine } from '@studio/core';
import { Button, Glyph, MenuLabel, MenuSeparator, Popover, type GlyphName } from '@studio/ui';
import { Timed, type Player } from '@studio/stage';
import { mmss, overlayFamily, overlayIcon, overlayName, overlayShort, overlayText, type Pace } from './model';

/** What's selected: a piece is `<sceneId>:<index>`, an explainer its scene id. */
export type Selection = { kind: 'step' | 'line' | 'overlay' | 'piece' | 'explainer'; id: string } | null;
export const pieceKey = (sceneId: string, index: number) => `${sceneId}:${index}`;

export interface TimelineStep {
  id: string;
  title: string;
  start: number;
  end: number;
  pace: Pace;
}

/** The tracks that can be shown under the three basic ones (Steps, Voice-over, On screen). */
export type ExtraTrack = 'recording' | 'camera' | 'captions' | 'notes';
export const EXTRA_TRACKS: { key: ExtraTrack; label: string; hint: string; icon: GlyphName }[] = [
  { key: 'recording', label: 'Recording', hint: 'Each piece, its speed, freezes and cuts', icon: 'film' },
  { key: 'camera', label: 'Camera', hint: 'Zooms that follow the clicks', icon: 'expand' },
  { key: 'captions', label: 'Captions', hint: 'Subtitles. Double-click one to edit it', icon: 'label' },
  { key: 'notes', label: 'Notes', hint: 'Notes you left for the agent', icon: 'pin' },
];

/** A piece of a recording, as drawn on the Recording track. */
export interface TrackPiece {
  sceneId: string;
  index: number;
  start: number;
  end: number;
  segment: Segment;
}

type Drag = {
  kind: 'step' | 'line' | 'overlay' | 'piece';
  id: string;
  mode: 'move' | 'start' | 'end';
  x0: number;
  dx: number;
};

const MIN_OVERLAY = 0.3;
const MIN_FREEZE = 0.1;
const MAX_FREEZE = 60;

const MAX_ROWS = 3;
/** Greedy packing into at most three rows, so overlapping overlays stay readable. */
function pack(items: OverlayInstance[]): Map<string, number> {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const o of [...items].sort((a, b) => a.start - b.start)) {
    let r = ends.findIndex((e) => e <= o.start + 1e-6);
    if (r < 0) r = ends.length < MAX_ROWS ? ends.push(0) - 1 : ends.indexOf(Math.min(...ends));
    ends[r] = Math.max(ends[r] ?? 0, o.end);
    out.set(o.id, r);
  }
  return out;
}

/** What a piece of the recording is called on its block. */
function pieceLabel(seg: Segment): { short: string; long: string } {
  if (seg.kind === 'hold') return { short: `Freeze ${seg.duration.toFixed(1)} s`, long: `Freeze for ${seg.duration.toFixed(1)} s` };
  if (seg.kind === 'speed') return { short: `${seg.rate}×`, long: `Plays at ${seg.rate}×` };
  return { short: 'Recording', long: 'Recording at normal speed' };
}

/**
 * The timeline under the video: a ruler with the playhead, then Steps, Voice-over and On screen,
 * plus any extra tracks picked under "Tracks" (Recording, Camera, Captions, Notes). Drag a step's
 * edge to trim it, a voice line to move it, an overlay or zoom (or its ends) to move it in time or
 * change how long it shows, and a piece of the recording's edge to trim it. Arrow keys nudge the
 * focused block.
 */
export function EditTimeline({
  player,
  duration,
  steps,
  explainers,
  lines,
  overlays,
  names,
  selection,
  onSelect,
  onTrimStep,
  onMoveLine,
  onOverlayTime,
  tracks,
  onTracks,
  pieces = [],
  cuts = [],
  zooms = [],
  captions = [],
  notes = [],
  onTrimPiece,
  onRestoreCut,
  onEditCaption,
  onNote,
  onFreezeLength,
  range = null,
  onRangeEnd,
}: {
  player: Player;
  duration: number;
  steps: TimelineStep[];
  /** Explainer scenes, drawn on the Steps track between the steps. */
  explainers: { id: string; title: string; start: number; end: number }[];
  lines: { line: VoiceLine; start: number; end: number }[];
  overlays: OverlayInstance[];
  names: Record<string, string | undefined>;
  selection: Selection;
  onSelect: (sel: Selection, seekTo?: number) => void;
  /** A step edge dragged to output time `to`. */
  onTrimStep: (stepId: string, edge: 'start' | 'end', to: number) => void;
  onMoveLine: (id: string, at: number) => void;
  onOverlayTime: (o: OverlayInstance, start: number, end: number, label: string) => void;
  /** Extra tracks shown below the basic three. */
  tracks: ExtraTrack[];
  onTracks: (tracks: ExtraTrack[]) => void;
  pieces?: TrackPiece[];
  /** Recording cut out after piece `after` of a scene, shown at output time `at`. */
  cuts?: { sceneId: string; after: number; at: number; label: string }[];
  /** Camera zooms (drawn by the pipeline, but movable in time like any overlay). */
  zooms?: OverlayInstance[];
  captions?: { id: string; start: number; end: number; text: string; edited?: boolean }[];
  /** `n`: the note's number in the batch (not sent yet); none once it's sent or done. */
  notes?: { id: string; t: number; text: string; done: boolean; n?: number }[];
  /** A piece edge dragged to a new take time. */
  onTrimPiece?: (sceneId: string, index: number, edge: { from?: number; to?: number }) => void;
  onRestoreCut?: (sceneId: string, after: number) => void;
  onEditCaption?: (index: number, text: string) => void;
  onNote?: (id: string) => void;
  /** A freeze's right edge dragged: its new length in seconds. */
  onFreezeLength?: (sceneId: string, index: number, seconds: number) => void;
  /** A part being marked to cut: clicks and drags on the timeline set its end. */
  range?: { from: number; to: number | null } | null;
  onRangeEnd?: (t: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const seeking = useRef(false);
  const ranging = useRef(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = (k: ExtraTrack) => tracks.includes(k);
  const toggle = (k: ExtraTrack) =>
    onTracks(shown(k) ? tracks.filter((x) => x !== k) : EXTRA_TRACKS.map((t) => t.key).filter((x) => x === k || shown(x)));
  const dur = Math.max(duration, 1);
  const innerW = Math.max(width, 100) * zoom;
  const pps = innerW / dur;
  const x = (t: number) => t * pps;
  const tick = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 64) ?? 120;
  const ticks = useMemo(() => Array.from({ length: Math.floor(dur / tick) + 1 }, (_, i) => i * tick), [dur, tick]);
  const rows = useMemo(() => pack(overlays), [overlays]);
  const zoomRows = useMemo(() => pack(zooms), [zooms]);
  const rowCount = Math.max(0, ...rows.values()) + 1;
  const zoomRowCount = Math.max(0, ...zoomRows.values()) + 1;

  // Zoomed in, the view follows the playhead while it plays.
  useEffect(
    () =>
      player.subscribe((s) => {
        const el = scroller.current;
        if (!el || !s.playing || zoom === 1) return;
        const px = s.t * pps;
        if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, px - 40);
      }),
    [player, pps, zoom],
  );

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left + el.scrollLeft) / pps, 0), dur);
  };
  const seekDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.ed-tlb, .ed-tl-cut, .ed-tl-pin, .ed-tl-cap-edit')) return;
    seeking.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    player.seek(timeAt(e.clientX));
  };
  const seekMove = (e: PointerEvent<HTMLDivElement>) => {
    if (seeking.current) player.seek(timeAt(e.clientX));
  };
  const seekUp = () => {
    seeking.current = false;
  };

  const begin = (e: PointerEvent<HTMLElement>, d: Omit<Drag, 'x0' | 'dx'>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget.closest('.ed-tlb') as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ ...d, x0: e.clientX, dx: 0 });
  };
  const move = (e: PointerEvent<HTMLElement>) => setDrag((d) => (d ? { ...d, dx: e.clientX - d.x0 } : d));
  /** Ends a drag: a click selects (and seeks), a real drag commits. */
  const end = (onClick: () => void, commit: (dt: number, mode: Drag['mode']) => void) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (Math.abs(d.dx) < 3) onClick();
    else commit(d.dx / pps, d.mode);
  };
  const dtOf = (kind: Drag['kind'], id: string, mode?: Drag['mode']) =>
    drag && drag.kind === kind && drag.id === id && (!mode || drag.mode === mode) ? drag.dx / pps : 0;

  const overlayTimes = (o: OverlayInstance) => {
    if (!drag || drag.kind !== 'overlay' || drag.id !== o.id) return { start: o.start, end: o.end };
    const dt = drag.dx / pps;
    if (drag.mode === 'move') {
      const s = Math.min(Math.max(o.start + dt, 0), dur - (o.end - o.start));
      return { start: s, end: s + (o.end - o.start) };
    }
    if (drag.mode === 'start') return { start: Math.min(Math.max(0, o.start + dt), o.end - MIN_OVERLAY), end: o.end };
    return { start: o.start, end: Math.max(Math.min(dur, o.end + dt), o.start + MIN_OVERLAY) };
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const nudge = (e: KeyboardEvent<HTMLElement>, sel: NonNullable<Selection>, seekTo: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(sel, seekTo);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.5);
    if (sel.kind === 'overlay') {
      const o = overlays.find((v) => v.id === sel.id) ?? zooms.find((v) => v.id === sel.id);
      if (!o) return;
      const s = Math.min(Math.max(o.start + d, 0), dur - (o.end - o.start));
      onOverlayTime(o, r2(s), r2(s + o.end - o.start), `Move ${overlayName(o, names[o.component]).toLowerCase()}`);
    } else if (sel.kind === 'line') {
      const l = lines.find((v) => v.line.id === sel.id);
      if (l) onMoveLine(l.line.id, r2(Math.max(0, l.start + d)));
    } else {
      player.seek(Math.min(Math.max(player.get().t + d, 0), dur));
    }
  };

  const isSel = (kind: NonNullable<Selection>['kind'], id: string) => selection?.kind === kind && selection.id === id;

  /** An overlay or a camera zoom: drag to move it, drag its ends to change when and how long it shows. */
  const overlayBlock = (o: OverlayInstance, cls: string, row: number) => {
    const t = overlayTimes(o);
    const name = overlayName(o, names[o.component]);
    const words = o.component === 'core:Zoom' ? '' : overlayText(o);
    const short = overlayShort(o, names[o.component]);
    const width = Math.max(x(t.end - t.start) - 2, 16);
    const sel: Selection = { kind: 'overlay', id: o.id };
    const commit = (dt: number, mode: Drag['mode']) => {
      const lower = name.toLowerCase();
      if (mode === 'move') {
        const s = Math.min(Math.max(o.start + dt, 0), dur - (o.end - o.start));
        onOverlayTime(o, r2(s), r2(s + o.end - o.start), `Move ${lower}`);
      } else if (mode === 'start') {
        onOverlayTime(o, r2(Math.min(Math.max(0, o.start + dt), o.end - MIN_OVERLAY)), o.end, `Change when the ${lower} shows`);
      } else {
        onOverlayTime(o, o.start, r2(Math.max(Math.min(dur, o.end + dt), o.start + MIN_OVERLAY)), `Change how long the ${lower} shows`);
      }
    };
    return (
      <div
        key={o.id}
        className={`ed-tlb ${cls}`}
        data-row={row}
        data-family={overlayFamily(o)}
        data-narrow={width < 34 || undefined}
        data-sel={isSel('overlay', o.id) || undefined}
        style={{ left: x(t.start), width }}
        tabIndex={0}
        role="button"
        aria-label={`${name}${words ? `: ${words}` : ''}, ${mmss(o.start)} to ${mmss(o.end)}. Arrow keys move it`}
        title={`${name}${words ? ` · ${words}` : ''}`}
        onPointerDown={(e) => begin(e, { kind: 'overlay', id: o.id, mode: 'move' })}
        onPointerMove={move}
        onPointerUp={() => end(() => onSelect(sel, Math.min(o.start + 0.4, o.end)), commit)}
        onKeyDown={(e) => nudge(e, sel!, Math.min(o.start + 0.4, o.end))}
      >
        <span className="ed-hd ed-hd-l" onPointerDown={(e) => begin(e, { kind: 'overlay', id: o.id, mode: 'start' })} />
        <span className="ed-tlb-ic" aria-hidden="true">
          <Glyph name={overlayIcon(o)} size={10} />
        </span>
        <span className="ed-tlb-tx">{short}</span>
        <span className="ed-hd ed-hd-r" onPointerDown={(e) => begin(e, { kind: 'overlay', id: o.id, mode: 'end' })} />
      </div>
    );
  };

  return (
    <section className="ed-tl" aria-label="Timeline">
      <div className="ed-tl-head">
        <span className="ed-tl-t">Timeline</span>
        <span className="ed-muted ed-s12 ed-tl-hint">Drag edges to trim or resize · drag bars to move · arrow keys nudge</span>
        <span className="ed-grow" />
        <label className="ed-muted ed-s12" htmlFor="ed-zoom">
          Zoom
        </label>
        <input id="ed-zoom" type="range" min={1} max={8} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        <span className="ed-tl-pick">
          <Button
            size="sm"
            variant={tracks.length ? 'secondary' : 'quiet'}
            aria-haspopup="true"
            aria-expanded={picker}
            onClick={() => setPicker((v) => !v)}
          >
            <Glyph name="timeline" size={12} />
            Tracks
            {tracks.length > 0 && <span className="ed-tl-count">+{tracks.length}</span>}
          </Button>
          <Popover open={picker} onClose={() => setPicker(false)} align="end" side="top" minWidth={300}>
            <div className="k-menu" role="group" aria-label="Tracks to show">
              <MenuLabel>Always shown: Steps, Voice-over, On screen</MenuLabel>
              {EXTRA_TRACKS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={shown(t.key)}
                  className="k-menu-item ed-tl-opt"
                  onClick={() => toggle(t.key)}
                >
                  <span className="ed-tl-opt-icon" aria-hidden="true">
                    <Glyph name={t.icon} size={14} />
                  </span>
                  <span className="ed-tl-opt-text">
                    {t.label}
                    <small>{t.hint}</small>
                  </span>
                  <span className="ed-tl-check" aria-hidden="true">
                    {shown(t.key) && <Glyph name="check" size={12} />}
                  </span>
                </button>
              ))}
              <MenuSeparator />
              <div className="ed-tl-opt-row">
                <Button size="sm" variant="quiet" onClick={() => onTracks(EXTRA_TRACKS.map((t) => t.key))}>
                  Show all
                </Button>
                <Button size="sm" variant="quiet" onClick={() => onTracks([])} disabled={!tracks.length}>
                  Just the basics
                </Button>
              </div>
            </div>
          </Popover>
        </span>
      </div>
      <div className="ed-tl-grid">
        <div className="ed-tl-labs" aria-hidden="true">
          <span />
          <span>Steps</span>
          <span>Voice-over</span>
          <span data-rows={rowCount}>On screen</span>
          {EXTRA_TRACKS.filter((t) => shown(t.key)).map((t) => (
            <span key={t.key} className="ed-tl-lab-x" data-rows={t.key === 'camera' ? zoomRowCount : 1}>
              <Glyph name={t.icon} size={11} />
              {t.label}
            </span>
          ))}
        </div>
        <div
          className="ed-tl-scroll"
          ref={scroller}
          onPointerDown={seekDown}
          onPointerMove={seekMove}
          onPointerUp={seekUp}
          onPointerCancel={seekUp}
        >
          <div className="ed-tl-in" style={{ width: innerW }}>
            <div className="ed-tl-ruler">
              {ticks.map((t) => (
                <span key={t} style={{ left: x(t) }}>
                  {mmss(t)}
                </span>
              ))}
            </div>
            <div className="ed-tl-track" role="group" aria-label="Steps">
              {explainers.map((e) => (
                <div
                  key={e.id}
                  className="ed-tlb ed-tlb-ex"
                  style={{ left: x(e.start), width: Math.max(x(e.end - e.start) - 2, 6) }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Explainer: ${e.title}, ${mmss(e.start)} to ${mmss(e.end)}`}
                  title={`Explainer: ${e.title}`}
                  onClick={() => player.seek(e.start + 0.01)}
                  onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), player.seek(e.start + 0.01))}
                >
                  <span className="ed-tlb-tx">{e.title}</span>
                </div>
              ))}
              {steps.map((s, i) => {
                const skip = s.pace.kind === 'skip';
                const ds = dtOf('step', s.id, 'start');
                const de = dtOf('step', s.id, 'end');
                const left = x(s.start + ds);
                const w = skip ? 10 : Math.max(x(s.end + de) - left - 2, 6);
                const sel: Selection = { kind: 'step', id: s.id };
                return (
                  <div
                    key={s.id}
                    className="ed-tlb ed-tlb-st"
                    data-pace={s.pace.kind}
                    data-sel={isSel('step', s.id) || undefined}
                    style={{ left, width: w }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Step ${i + 1}, ${s.title}, ${skip ? 'skipped' : `${mmss(s.start)} to ${mmss(s.end)}`}. Drag an edge to trim it`}
                    title={`${i + 1}. ${s.title}`}
                    onPointerDown={(e) => begin(e, { kind: 'step', id: s.id, mode: 'move' })}
                    onPointerMove={move}
                    onPointerUp={() =>
                      end(
                        () => onSelect(sel, s.start + 0.01),
                        (dt, mode) => {
                          if (mode === 'start') onTrimStep(s.id, 'start', r2(s.start + dt));
                          else if (mode === 'end') onTrimStep(s.id, 'end', r2(s.end + dt));
                        },
                      )
                    }
                    onKeyDown={(e) => nudge(e, sel!, s.start + 0.01)}
                  >
                    {!skip && <span className="ed-hd ed-hd-l" onPointerDown={(e) => begin(e, { kind: 'step', id: s.id, mode: 'start' })} />}
                    <span className="ed-tlb-tx">
                      {i + 1} · {s.title}
                    </span>
                    {!skip && <span className="ed-hd ed-hd-r" onPointerDown={(e) => begin(e, { kind: 'step', id: s.id, mode: 'end' })} />}
                  </div>
                );
              })}
            </div>
            <div className="ed-tl-track" role="group" aria-label="Voice-over">
              {lines.map((l, i) => {
                const dt = dtOf('line', l.line.id);
                const sel: Selection = { kind: 'line', id: l.line.id };
                return (
                  <div
                    // Older projects can hold two lines with the same id; the index keeps keys unique.
                    key={`${l.line.id}:${i}`}
                    className="ed-tlb ed-tlb-vo"
                    data-sel={isSel('line', l.line.id) || undefined}
                    data-silent={!l.line.audio || undefined}
                    style={{ left: x(Math.max(0, l.start + dt)), width: Math.max(x(l.end - l.start) - 2, 6) }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Voice-over at ${mmss(l.start)}: ${l.line.text}. Drag or use the arrow keys to move it`}
                    title={l.line.text}
                    onPointerDown={(e) => begin(e, { kind: 'line', id: l.line.id, mode: 'move' })}
                    onPointerMove={move}
                    onPointerUp={() =>
                      end(
                        () => onSelect(sel, l.start + 0.01),
                        (d) => onMoveLine(l.line.id, r2(Math.max(0, l.start + d))),
                      )
                    }
                    onKeyDown={(e) => nudge(e, sel!, l.start + 0.01)}
                  >
                    <span className="ed-tlb-tx">{l.line.text}</span>
                  </div>
                );
              })}
            </div>
            <div className="ed-tl-track" role="group" aria-label="On screen" data-rows={rowCount}>
              {overlays.map((o) => overlayBlock(o, 'ed-tlb-ov', rows.get(o.id) ?? 0))}
            </div>

            {shown('recording') && (
              <div className="ed-tl-track ed-tl-track-x" role="group" aria-label="Recording">
                {pieces.map((p) => {
                  const seg = p.segment;
                  const id = `${p.sceneId}:${p.index}`;
                  const ds = dtOf('piece', id, 'start');
                  const de = dtOf('piece', id, 'end');
                  const left = x(p.start + ds);
                  const w = Math.max(x(p.end + de) - left - 2, 4);
                  const { short, long } = pieceLabel(seg);
                  const rate = seg.kind === 'speed' ? seg.rate : 1;
                  const trimmable = seg.kind !== 'hold' && !!onTrimPiece;
                  const hold = seg.kind === 'hold';
                  const stretch = hold && !!onFreezeLength;
                  const sel: Selection = { kind: 'piece', id };
                  return (
                    <div
                      key={id}
                      className="ed-tlb ed-tlb-rec"
                      data-kind={seg.kind}
                      data-hand={seg.manual || undefined}
                      data-sel={isSel('piece', id) || undefined}
                      style={{ left, width: w }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${long}${seg.manual ? ', edited by hand' : ''}, ${mmss(p.start)} to ${mmss(p.end)}. Press Enter to edit it${trimmable ? ', or drag an edge to trim it' : stretch ? ', or drag its right edge to change its length' : ''}`}
                      title={`${long}${seg.manual ? ' · edited by hand' : ''} · ${mmss(p.start)}–${mmss(p.end)}`}
                      onPointerDown={(e) => begin(e, { kind: 'piece', id, mode: 'move' })}
                      onPointerMove={move}
                      onPointerUp={() =>
                        end(
                          () => onSelect(sel, p.start + 0.01),
                          (dt, mode) => {
                            if (hold && mode === 'end' && stretch) {
                              const len = Math.min(Math.max(seg.duration + dt, MIN_FREEZE), MAX_FREEZE);
                              onFreezeLength!(p.sceneId, p.index, Math.round(len * 10) / 10);
                              return;
                            }
                            if (!trimmable || mode === 'move' || !('from' in seg)) return;
                            const take = (mode === 'start' ? seg.from : seg.to) + dt * rate;
                            const at = Math.max(0, Math.round(take * 1000) / 1000);
                            onTrimPiece!(p.sceneId, p.index, mode === 'start' ? { from: at } : { to: at });
                          },
                        )
                      }
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(sel, p.start + 0.01))}
                    >
                      {trimmable && <span className="ed-hd ed-hd-l" onPointerDown={(e) => begin(e, { kind: 'piece', id, mode: 'start' })} />}
                      <span className="ed-tlb-tx">
                        {hold && <Glyph name="pause" size={9} />} {hold && de ? `Freeze ${Math.min(Math.max(seg.duration + de, MIN_FREEZE), MAX_FREEZE).toFixed(1)} s` : short}
                      </span>
                      {(trimmable || stretch) && (
                        <span className="ed-hd ed-hd-r" onPointerDown={(e) => begin(e, { kind: 'piece', id, mode: 'end' })} />
                      )}
                    </div>
                  );
                })}
                {cuts.map((c) => (
                  <button
                    key={`cut-${c.sceneId}-${c.after}`}
                    type="button"
                    className="ed-tl-cut"
                    style={{ left: x(c.at) }}
                    aria-label={`Put back the recording that was cut here (${c.label})`}
                    title={`Cut here: ${c.label} of the recording. Click to put it back`}
                    onClick={() => onRestoreCut?.(c.sceneId, c.after)}
                  >
                    <Glyph name="plus" size={9} />
                  </button>
                ))}
              </div>
            )}

            {shown('camera') && (
              <div className="ed-tl-track ed-tl-track-x" role="group" aria-label="Camera" data-rows={zoomRowCount}>
                {zooms.length ? (
                  zooms.map((o) => overlayBlock(o, 'ed-tlb-cam', zoomRows.get(o.id) ?? 0))
                ) : (
                  <span className="ed-tl-empty">No zooms. The camera stays on the whole screen</span>
                )}
              </div>
            )}

            {shown('captions') && (
              <div className="ed-tl-track ed-tl-track-x" role="group" aria-label="Captions">
                {captions.length ? (
                  captions.map((c, i) =>
                    editing?.index === i ? (
                      <textarea
                        key={c.id}
                        className="ed-tl-cap-edit"
                        aria-label="Caption text"
                        autoFocus
                        value={editing.text}
                        style={{ left: x(c.start) }}
                        onChange={(e) => setEditing({ index: i, text: e.target.value })}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Escape') setEditing(null);
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            const t = editing.text.trim();
                            if (t && t !== c.text) onEditCaption?.(i, t);
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      <div
                        key={c.id}
                        className="ed-tlb ed-tlb-cap"
                        data-edited={c.edited || undefined}
                        style={{ left: x(c.start), width: Math.max(x(c.end - c.start) - 2, 6) }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Caption at ${mmss(c.start)}: ${c.text}. Press Enter to edit`}
                        title={`${c.text}${c.edited ? ' (edited)' : ''} · double-click to edit`}
                        onClick={() => player.seek(c.start + 0.01)}
                        onDoubleClick={() => onEditCaption && setEditing({ index: i, text: c.text })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && onEditCaption) {
                            e.preventDefault();
                            setEditing({ index: i, text: c.text });
                          }
                        }}
                      >
                        <span className="ed-tlb-tx">{c.text.replace('\n', ' ')}</span>
                      </div>
                    ),
                  )
                ) : (
                  <span className="ed-tl-empty">No captions yet. They're made from the voice-over</span>
                )}
              </div>
            )}

            {shown('notes') && (
              <div className="ed-tl-track ed-tl-track-x" role="group" aria-label="Notes">
                {notes.length ? (
                  notes.map((n) => {
                    const name = n.n ? `Note ${n.n}` : n.done ? 'Done note' : 'Sent note';
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className="ed-tl-pin"
                        data-done={n.done || undefined}
                        data-empty={(n.n && !n.text.trim()) || undefined}
                        style={{ left: x(n.t) }}
                        aria-label={`${name} at ${mmss(n.t)}${n.text ? `: ${n.text}` : ', no message yet'}`}
                        title={n.text || 'No message yet'}
                        onClick={() => {
                          player.seek(n.t);
                          onNote?.(n.id);
                        }}
                      >
                        {n.n ?? <Glyph name="check" size={9} />}
                      </button>
                    );
                  })
                ) : (
                  <span className="ed-tl-empty">No notes. Use the pin under the video to point something out</span>
                )}
              </div>
            )}

            {range && (
              <>
                {range.to !== null && (
                  <div
                    className="ed-tl-range"
                    style={{ left: x(Math.min(range.from, range.to)), width: Math.max(x(Math.abs(range.to - range.from)), 2) }}
                    aria-hidden="true"
                  />
                )}
                <div className="ed-tl-range-from" style={{ left: x(range.from) }} aria-hidden="true" />
                <div
                  className="ed-tl-rangelayer"
                  aria-hidden="true"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    ranging.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    onRangeEnd?.(timeAt(e.clientX));
                  }}
                  onPointerMove={(e) => ranging.current && onRangeEnd?.(timeAt(e.clientX))}
                  onPointerUp={() => {
                    ranging.current = false;
                  }}
                  onPointerCancel={() => {
                    ranging.current = false;
                  }}
                />
              </>
            )}
            <Timed player={player}>{(t) => <div className="ed-tl-ph" style={{ left: x(t) }} />}</Timed>
          </div>
        </div>
      </div>
    </section>
  );
}
