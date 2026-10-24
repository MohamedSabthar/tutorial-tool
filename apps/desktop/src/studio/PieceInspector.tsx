import { useState } from 'react';
import { segmentDuration, type PieceEdit, type Segment } from '@studio/core';
import { Button, Chip, Field, Input, Panel, Segmented } from '@studio/ui';

const SPEEDS = ['1', '1.5', '2', '4', '8', '16'] as const;
const fmt = (n: number) => `${n.toFixed(1)} s`;

/**
 * Edits one piece of the recording by hand: its speed, a freeze at the playhead, or taking it
 * off camera. Hand-edited pieces keep their settings when the timing is fitted again;
 * "Back to automatic" hands the piece back to the fit.
 */
export function PieceInspector({
  segment,
  playheadTake,
  onEdit,
  onClose,
  looping,
  onLoop,
}: {
  segment: Segment;
  /** Playback repeats this piece while on. */
  looping: boolean;
  onLoop: (on: boolean) => void;
  /** Take time under the playhead if it is inside this piece (read when freezing). */
  playheadTake: () => number | null;
  onEdit: (edit: PieceEdit) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freeze, setFreeze] = useState('2');
  const [custom, setCustom] = useState('');
  const hold = segment.kind === 'hold';
  const rate = segment.kind === 'speed' ? segment.rate : 1;

  const run = async (edit: PieceEdit) => {
    setBusy(true);
    setError(null);
    try {
      await onEdit(edit);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const seconds = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 60 ? n : null;
  };

  return (
    <Panel
      title={hold ? 'Freeze' : 'Recording piece'}
      action={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="piece-facts">
        {!hold && (
          <span className="ui-mono">
            Recording {fmt(segment.from)}–{fmt(segment.to)}
          </span>
        )}
        <span className="ui-mono">Plays {fmt(segmentDuration(segment))}</span>
        <Chip
          tone={segment.manual ? 'info' : 'neutral'}
          title={
            segment.manual
              ? 'Fit timing and the voice-over keep this piece as you set it.'
              : 'Fit timing sets this piece; edit it to keep your own setting.'
          }
        >
          {segment.manual ? 'Edited by hand' : 'Automatic'}
        </Chip>
      </div>

      {hold ? (
        <Field label="Freeze length (seconds)">
          {(id) => (
            <div className="piece-row">
              <Input
                id={id}
                type="number"
                min={0.1}
                max={60}
                step={0.1}
                defaultValue={segment.duration}
                key={segment.duration}
                onKeyDown={(e) => {
                  const n = seconds(e.currentTarget.value);
                  if (e.key === 'Enter' && n) void run({ op: 'duration', duration: n });
                }}
                onBlur={(e) => {
                  const n = seconds(e.currentTarget.value);
                  if (n && Math.abs(n - segment.duration) > 1e-3) void run({ op: 'duration', duration: n });
                }}
              />
            </div>
          )}
        </Field>
      ) : (
        <>
          <div className="piece-group">
            <span className="piece-label">Speed</span>
            <Segmented
              label="Speed"
              options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))}
              // A speed set by hand that isn't in the list leaves every option unpressed.
              value={String(rate) as (typeof SPEEDS)[number]}
              disabled={busy}
              onChange={(v) => void run({ op: 'speed', rate: Number(v) })}
            />
            <Field label="Other speed (0.25–16×)">
              {(id) => (
                <div className="piece-row">
                  <Input
                    id={id}
                    type="number"
                    min={0.25}
                    max={16}
                    step={0.25}
                    placeholder={String(rate)}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={busy || !(Number(custom) >= 0.25 && Number(custom) <= 16)}
                    onClick={() => void run({ op: 'speed', rate: Number(custom) }).then(() => setCustom(''))}
                  >
                    Set
                  </Button>
                </div>
              )}
            </Field>
          </div>
          <div className="piece-row">
            {(['from', 'to'] as const).map((edge) => (
              <Field key={edge} label={edge === 'from' ? 'Starts at (recording s)' : 'Ends at (recording s)'}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    step={0.1}
                    defaultValue={segment[edge]}
                    key={segment[edge]}
                    title="Trim or extend the piece; drag its edges on the timeline to do the same"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      const n = Number(e.currentTarget.value);
                      if (Number.isFinite(n) && Math.abs(n - segment[edge]) > 1e-3)
                        void run({ op: 'trim', [edge]: n });
                    }}
                  />
                )}
              </Field>
            ))}
          </div>
          <Field
            label="Freeze at the playhead (seconds)"
            hint="Freezes the frame under the playhead, inside this piece."
          >
            {(id) => (
              <div className="piece-row">
                <Input
                  id={id}
                  type="number"
                  min={0.1}
                  max={60}
                  step={0.5}
                  value={freeze}
                  onChange={(e) => setFreeze(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={busy || !seconds(freeze)}
                  onClick={() => {
                    const at = playheadTake();
                    if (at === null) setError('Move the playhead into this piece first.');
                    else void run({ op: 'freeze', at, duration: seconds(freeze)! });
                  }}
                >
                  Freeze here
                </Button>
              </div>
            )}
          </Field>
        </>
      )}

      <div className="piece-row">
        <Button
          size="sm"
          aria-pressed={looping}
          onClick={() => onLoop(!looping)}
          title="Play this piece over and over while you adjust it"
        >
          {looping ? 'Looping' : 'Loop this piece'}
        </Button>
      </div>

      <div className="piece-row">
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void run({ op: 'remove' })}>
          {hold ? 'Remove freeze' : 'Remove (off camera)'}
        </Button>
        {segment.manual && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ op: 'auto' })}>
            Back to automatic
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="piece-error">
          {error}
        </p>
      )}
    </Panel>
  );
}
