import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Timed, type Player } from '@studio/stage';
import { mmss } from './model';

/**
 * The scrubber shown in full screen, where the timeline is hidden: one segment per step, filled
 * as it plays. Drag the handle or click anywhere to jump; hover shows the time and step. Arrow
 * keys move 5 s (1 s with Shift), Home and End go to the ends.
 */
export function FullScrubber({
  player,
  duration,
  steps,
}: {
  player: Player;
  duration: number;
  steps: { id: string; title: string; start: number; end: number }[];
}) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const dur = Math.max(duration, 0.01);
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const f = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    return { x: f * r.width, t: f * dur };
  };
  const stepAt = (t: number) => steps.find((s) => t >= s.start && t < s.end) ?? steps.at(-1);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    player.seek(at(e.clientX).t);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = at(e.clientX);
    setHover(p);
    if (dragging.current) player.seek(p.t);
  };
  const up = () => {
    dragging.current = false;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = player.get().t;
    const step = e.shiftKey ? 1 : 5;
    const to =
      e.key === 'ArrowLeft' ? t - step : e.key === 'ArrowRight' ? t + step : e.key === 'Home' ? 0 : e.key === 'End' ? dur : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    player.seek(Math.min(Math.max(to, 0), dur));
  };
  const hoverStep = hover ? stepAt(hover.t) : undefined;
  return (
    <Timed player={player}>
      {(t) => {
        const cur = stepAt(t);
        return (
          <div
            ref={bar}
            className="ed-fs"
            role="slider"
            tabIndex={0}
            aria-label="Position in the video"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(t)}
            aria-valuetext={`${mmss(t)}${cur ? `, step ${steps.indexOf(cur) + 1}: ${cur.title}` : ''}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={() => !dragging.current && setHover(null)}
            onKeyDown={key}
          >
            <div className="ed-fs-track">
              {steps.map((s) => {
                const fill = t >= s.end ? 1 : t <= s.start ? 0 : (t - s.start) / Math.max(s.end - s.start, 0.01);
                return (
                  <span
                    key={s.id}
                    className="ed-fs-seg"
                    style={{ left: `${(s.start / dur) * 100}%`, width: `${((s.end - s.start) / dur) * 100}%` }}
                  >
                    <i style={{ width: `${fill * 100}%` }} />
                  </span>
                );
              })}
            </div>
            <span className="ed-fs-thumb" style={{ left: `${(t / dur) * 100}%` }} aria-hidden="true" />
            {hover && (
              <span className="ed-fs-tip" style={{ left: hover.x }} aria-hidden="true">
                <b>{mmss(hover.t)}</b>
                {hoverStep && (
                  <span>
                    {steps.indexOf(hoverStep) + 1} · {hoverStep.title}
                  </span>
                )}
              </span>
            )}
          </div>
        );
      }}
    </Timed>
  );
}
