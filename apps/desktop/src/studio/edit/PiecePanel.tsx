import { useState } from 'react';
import type { PieceEdit, Segment } from '@studio/core';
import { Button, Glyph, IconButton, Shell, ShellHeader, ShellPanel, StatusPill } from '@studio/ui';
import { mmss } from './model';

const SPEEDS = [1, 1.5, 2, 4] as const;
const seconds = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.1 && n <= 60 ? Math.round(n * 10) / 10 : null;
};

/** What a piece of the recording does, in a sentence. */
function describe(seg: Segment): string {
  if (seg.kind === 'hold') return `Holds one frame still for ${seg.duration.toFixed(1)} s, so the voice-over can catch up.`;
  const from = `${mmss(seg.from)}–${mmss(seg.to)} of the recording`;
  if (seg.kind === 'speed') return `Plays ${from} at ${seg.rate}× speed.`;
  return `Plays ${from} at normal speed.`;
}

/**
 * One piece of the recording, picked on the Recording track: its speed, a freeze at the playhead,
 * a freeze's length, taking it out, and handing it back to the automatic timing.
 */
export function PiecePanel({
  segment,
  start,
  end,
  busy,
  playheadInside,
  onEdit,
  onFreeze,
  onClose,
}: {
  segment: Segment;
  /** Where the piece plays in the video. */
  start: number;
  end: number;
  busy: boolean;
  /** Whether the playhead is on this piece (a freeze goes under it). */
  playheadInside: boolean;
  onEdit: (edit: PieceEdit) => void;
  /** Freezes the frame under the playhead for `seconds`. */
  onFreeze: (seconds: number) => void;
  onClose: () => void;
}) {
  const hold = segment.kind === 'hold';
  const rate = segment.kind === 'speed' ? segment.rate : 1;
  const [freeze, setFreeze] = useState('2');
  const [length, setLength] = useState(hold ? String(segment.duration) : '2');
  const len = Math.round((end - start) * 10) / 10;
  return (
    <Shell className="ed-side" aria-label={hold ? 'Freeze' : 'Part of the recording'}>
      <ShellHeader
        icon={hold ? 'pause' : 'film'}
        title={hold ? 'Freeze' : 'Part of the recording'}
        subtitle={
          <span className="ed-tab">
            {mmss(start)}–{mmss(end)} · {len} s
          </span>
        }
        aside={
          <IconButton variant="quiet" label="Close and go back to the step" onClick={onClose}>
            <Glyph name="x" size={14} />
          </IconButton>
        }
      />
      <ShellPanel className="ed-sp">
        <div className="ed-sec">
          <p className="ed-s13 ed-pc-d">{describe(segment)}</p>
          <span>
            <StatusPill
              tone={segment.manual ? 'brand' : 'neutral'}
              title={
                segment.manual
                  ? 'Lining up clicks with the voice keeps this part as you set it.'
                  : 'Set automatically to fit the voice-over. Change it to keep your own setting.'
              }
            >
              {segment.manual ? 'Set by you' : 'Automatic'}
            </StatusPill>
          </span>
        </div>

        {hold ? (
          <div className="ed-sec">
            <div className="ed-sec-h">
              <Glyph name="clock" size={12} />
              <span>Length</span>
            </div>
            <form
              className="ed-row"
              onSubmit={(e) => {
                e.preventDefault();
                const n = seconds(length);
                if (n && Math.abs(n - segment.duration) > 1e-3) onEdit({ op: 'duration', duration: n });
              }}
            >
              <label className="ed-sr" htmlFor="ed-pc-len">
                Freeze length in seconds
              </label>
              <input
                id="ed-pc-len"
                className="ed-input ed-pc-num"
                type="number"
                min={0.1}
                max={60}
                step={0.5}
                value={length}
                onChange={(e) => setLength(e.target.value)}
              />
              <span className="ed-muted ed-s13">seconds</span>
              <Button size="sm" type="submit" disabled={busy || !seconds(length) || seconds(length) === segment.duration}>
                Set
              </Button>
            </form>
            <p className="ed-muted ed-s12">Or drag its right edge on the timeline.</p>
          </div>
        ) : (
          <>
            <div className="ed-sec">
              <div className="ed-sec-h">
                <Glyph name="gauge" size={12} />
                <span id="ed-pc-speed">Speed</span>
              </div>
              <div role="group" aria-labelledby="ed-pc-speed" className="ui-seg ui-seg-block">
                {SPEEDS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="ui-seg-item"
                    aria-pressed={Math.abs(rate - r) < 1e-3}
                    disabled={busy}
                    onClick={() => Math.abs(rate - r) > 1e-3 && onEdit({ op: 'speed', rate: r })}
                  >
                    {r}×
                  </button>
                ))}
              </div>
              {!SPEEDS.some((r) => Math.abs(rate - r) < 1e-3) && (
                <p className="ed-muted ed-s12">Plays at {rate}× now.</p>
              )}
            </div>

            <div className="ed-sec">
              <div className="ed-sec-h">
                <Glyph name="pause" size={12} />
                <span>Freeze</span>
              </div>
              <form
                className="ed-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = seconds(freeze);
                  if (n) onFreeze(n);
                }}
              >
                <Button size="sm" type="submit" disabled={busy || !seconds(freeze) || !playheadInside}>
                  <Glyph name="pause" size={12} />
                  Freeze here
                </Button>
                <span className="ed-muted ed-s13">for</span>
                <label className="ed-sr" htmlFor="ed-pc-freeze">
                  Freeze length in seconds
                </label>
                <input
                  id="ed-pc-freeze"
                  className="ed-input ed-pc-num"
                  type="number"
                  min={0.1}
                  max={60}
                  step={0.5}
                  value={freeze}
                  onChange={(e) => setFreeze(e.target.value)}
                />
                <span className="ed-muted ed-s13">s</span>
              </form>
              <p className="ed-muted ed-s12">
                {playheadInside
                  ? 'Holds the frame under the playhead, then carries on.'
                  : 'Move the playhead onto this part first.'}
              </p>
            </div>
          </>
        )}

        <div className="ed-sec">
          <div className="ed-row">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => onEdit({ op: 'remove' })}>
              <Glyph name="trash" size={12} />
              {hold ? 'Remove this freeze' : 'Remove this part'}
            </Button>
            {segment.manual && (
              <Button
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => onEdit({ op: 'auto' })}
                title="Let the automatic timing set this part again"
              >
                Back to automatic
              </Button>
            )}
          </div>
          {!hold && <p className="ed-muted ed-s12">A removed part leaves a red mark on the timeline. Click it to put the part back.</p>}
        </div>
      </ShellPanel>
    </Shell>
  );
}
