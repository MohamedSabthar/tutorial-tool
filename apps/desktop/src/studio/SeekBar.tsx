import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Timed, type Player } from '@studio/stage';

/**
 * The preview's seek bar: progress, step ticks and a handle. Click or drag to seek (playback
 * pauses while dragging and resumes after); hovering shows the time under the pointer. With
 * focus, ←/→ move 1 s (Shift: 5 s) and Home/End jump to the ends.
 */
export function SeekBar({
  player,
  duration,
  ticks,
  format,
}: {
  player: Player;
  duration: number;
  ticks: { id: string; start: number; label?: string }[];
  format: (t: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const resume = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const clamp = (t: number) => Math.min(Math.max(t, 0), duration);
  const pct = (t: number) => (duration > 0 ? (clamp(t) / duration) * 100 : 0);

  const timeAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    return clamp(((e.clientX - rect.left) / rect.width) * duration);
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const t = player.get().t;
    const by = e.shiftKey ? 5 : 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? t + by
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? t - by
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? duration
              : null;
    if (next === null) return;
    // The Studio's own arrow keys step one frame; here they move by seconds.
    e.preventDefault();
    e.stopPropagation();
    player.seek(clamp(next));
  }

  return (
    <Timed player={player}>
      {(t) => (
        <div
          ref={ref}
          className="seek-bar"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(t * 100) / 100}
          aria-valuetext={`${format(t)} of ${format(duration)}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            resume.current = player.get().playing;
            player.pause();
            player.seek(timeAt(e));
          }}
          onPointerMove={(e) => {
            setHover(timeAt(e));
            if (e.currentTarget.hasPointerCapture(e.pointerId)) player.seek(timeAt(e));
          }}
          onPointerUp={() => {
            if (resume.current) player.play();
            resume.current = false;
          }}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
        >
          <span className="seek-bar-track" aria-hidden="true">
            <span className="seek-bar-fill" style={{ width: `${pct(t)}%` }} />
            {ticks.map((s) => (
              <span key={s.id} className="seek-bar-tick" style={{ left: `${pct(s.start)}%` }} />
            ))}
          </span>
          <span className="seek-bar-handle" aria-hidden="true" style={{ left: `${pct(t)}%` }} />
          {hover !== null && (
            <span className="seek-bar-tip ui-mono" aria-hidden="true" style={{ left: `${pct(hover)}%` }}>
              {format(hover)}
            </span>
          )}
        </div>
      )}
    </Timed>
  );
}
