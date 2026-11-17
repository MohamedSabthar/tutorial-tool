import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { OverlayInstance, VoiceLine } from '@studio/core';
import { Button, Glyph } from '@studio/ui';
import { Timed, type Player } from '@studio/stage';
import { mmss, overlayName, overlayText, type Pace } from './model';

export type Selection = { kind: 'step' | 'line' | 'overlay'; id: string } | null;

export interface TimelineStep {
  id: string;
  title: string;
  start: number;
  end: number;
  pace: Pace;
}

type Drag = {
  kind: 'step' | 'line' | 'overlay';
  id: string;
  mode: 'move' | 'start' | 'end';
  x0: number;
  dx: number;
};

const MIN_OVERLAY = 0.3;

/** Greedy packing into at most two rows, so the overlays track stays one row tall. */
function pack(items: OverlayInstance[]): Map<string, number> {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const o of [...items].sort((a, b) => a.start - b.start)) {
    let r = ends.findIndex((e) => e <= o.start + 1e-6);
    if (r < 0) r = ends.length < 2 ? ends.push(0) - 1 : ends[0]! <= ends[1]! ? 0 : 1;
    ends[r] = Math.max(ends[r] ?? 0, o.end);
    out.set(o.id, r);
  }
  return out;
}

/**
 * The compact timeline under the video: a ruler with the playhead, then Steps, Voice-over and
 * On screen. Drag a step's edge to trim it, a voice line to move it, and an overlay (or its
 * ends) to move it in time or change how long it shows. Arrow keys nudge the focused block.
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
  onMore,
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
  onMore: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const seeking = useRef(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dur = Math.max(duration, 1);
  const innerW = Math.max(width, 100) * zoom;
  const pps = innerW / dur;
  const x = (t: number) => t * pps;
  const tick = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 64) ?? 120;
  const ticks = useMemo(() => Array.from({ length: Math.floor(dur / tick) + 1 }, (_, i) => i * tick), [dur, tick]);
  const rows = useMemo(() => pack(overlays), [overlays]);
  const twoRows = [...rows.values()].some((r) => r > 0);

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
    if ((e.target as HTMLElement).closest('.ed-tlb')) return;
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
  const end = (sel: Selection, seekTo: number, commit: (dt: number, mode: Drag['mode']) => void) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (Math.abs(d.dx) < 3) onSelect(sel, seekTo);
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
      const o = overlays.find((x) => x.id === sel.id);
      if (!o) return;
      const s = Math.min(Math.max(o.start + d, 0), dur - (o.end - o.start));
      onOverlayTime(o, r2(s), r2(s + o.end - o.start), `Move ${overlayName(o, names[o.component]).toLowerCase()}`);
    } else if (sel.kind === 'line') {
      const l = lines.find((x) => x.line.id === sel.id);
      if (l) onMoveLine(l.line.id, r2(Math.max(0, l.start + d)));
    } else {
      player.seek(Math.min(Math.max(player.get().t + d, 0), dur));
    }
  };

  const isSel = (kind: NonNullable<Selection>['kind'], id: string) => selection?.kind === kind && selection.id === id;

  return (
    <section className="ed-tl" aria-label="Timeline">
      <div className="ed-tl-head">
        <span className="ed-tl-t">Timeline</span>
        <span className="ed-muted ed-s12 ed-tl-hint">Drag edges to trim or resize · drag bars to move · arrow keys nudge</span>
        <span className="ed-grow" />
        <label className="ed-muted ed-s12" htmlFor="ed-zoom">
          Zoom
        </label>
        <input
          id="ed-zoom"
          type="range"
          min={1}
          max={8}
          step={0.5}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <Button size="sm" variant="quiet" onClick={onMore} title="Camera, captions, notes and every piece of the recording">
          <Glyph name="timeline" size={12} />
          More tracks…
        </Button>
      </div>
      <div className="ed-tl-grid">
        <div className="ed-tl-labs" aria-hidden="true">
          <span />
          <span>Steps</span>
          <span>Voice-over</span>
          <span>On screen</span>
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
                      end(sel, s.start + 0.01, (dt, mode) => {
                        if (mode === 'start') onTrimStep(s.id, 'start', r2(s.start + dt));
                        else if (mode === 'end') onTrimStep(s.id, 'end', r2(s.end + dt));
                      })
                    }
                    onKeyDown={(e) => nudge(e, sel!, s.start + 0.01)}
                  >
                    {!skip && (
                      <span
                        className="ed-hd ed-hd-l"
                        onPointerDown={(e) => begin(e, { kind: 'step', id: s.id, mode: 'start' })}
                      />
                    )}
                    <span className="ed-tlb-tx">
                      {i + 1} · {s.title}
                    </span>
                    {!skip && (
                      <span
                        className="ed-hd ed-hd-r"
                        onPointerDown={(e) => begin(e, { kind: 'step', id: s.id, mode: 'end' })}
                      />
                    )}
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
                      end(sel, l.start + 0.01, (d) => onMoveLine(l.line.id, r2(Math.max(0, l.start + d))))
                    }
                    onKeyDown={(e) => nudge(e, sel!, l.start + 0.01)}
                  >
                    <span className="ed-tlb-tx">{l.line.text}</span>
                  </div>
                );
              })}
            </div>
            <div className="ed-tl-track" role="group" aria-label="On screen" data-rows={twoRows ? 2 : 1}>
              {overlays.map((o) => {
                const t = overlayTimes(o);
                const name = overlayName(o, names[o.component]);
                const words = overlayText(o);
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
                    className="ed-tlb ed-tlb-ov"
                    data-row={rows.get(o.id) ?? 0}
                    data-sel={isSel('overlay', o.id) || undefined}
                    style={{ left: x(t.start), width: Math.max(x(t.end - t.start) - 2, 30) }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${name}${words ? `: ${words}` : ''}, ${mmss(o.start)} to ${mmss(o.end)}. Arrow keys move it`}
                    title={`${name}${words ? ` · ${words}` : ''}`}
                    onPointerDown={(e) => begin(e, { kind: 'overlay', id: o.id, mode: 'move' })}
                    onPointerMove={move}
                    onPointerUp={() => end(sel, Math.min(o.start + 0.4, o.end), commit)}
                    onKeyDown={(e) => nudge(e, sel!, Math.min(o.start + 0.4, o.end))}
                  >
                    <span
                      className="ed-hd ed-hd-l"
                      onPointerDown={(e) => begin(e, { kind: 'overlay', id: o.id, mode: 'start' })}
                    />
                    <span className="ed-tlb-tx">
                      {name}
                      {words ? ` · ${words}` : ''}
                    </span>
                    <span
                      className="ed-hd ed-hd-r"
                      onPointerDown={(e) => begin(e, { kind: 'overlay', id: o.id, mode: 'end' })}
                    />
                  </div>
                );
              })}
            </div>
            <Timed player={player}>{(t) => <div className="ed-tl-ph" style={{ left: x(t) }} />}</Timed>
          </div>
        </div>
      </div>
    </section>
  );
}

