import { useState } from 'react';
import type { VoiceLine } from '@studio/core';
import { Button, Chip, Field, Panel, TextArea } from '@studio/ui';

/**
 * Writes a voice line by hand (voiced at the playhead), or edits a selected one: new text is
 * voiced again, it can move to the playhead, or be deleted. Hand-written lines stay when the
 * voice-over is generated again.
 */
export function VoiceLinePanel({
  line,
  ownerLabel,
  playhead,
  onAdd,
  onEdit,
  onRemove,
  onClose,
}: {
  /** The selected line, or null to write a new one. */
  line: VoiceLine | null;
  /** The step or explainer the line belongs to. */
  ownerLabel?: string;
  /** Output time of the playhead (read when placing). */
  playhead: () => number;
  onAdd: (text: string, at: number) => Promise<void>;
  onEdit: (p: { text?: string; at?: number }) => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(line?.text ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = line ? text.trim() !== line.text : text.trim().length > 0;

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title={line ? 'Voice line' : 'New voice line'}
      action={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {line && (
        <div className="piece-facts">
          {ownerLabel && <span>{ownerLabel}</span>}
          <span className="ui-mono">{line.duration.toFixed(1)} s</span>
          <Chip
            tone={line.manual ? 'info' : 'neutral'}
            title={
              line.manual
                ? 'Kept when the voice-over is generated again.'
                : "Generated from the step's narration; editing it here makes it hand-written."
            }
          >
            {line.manual ? 'Hand-written' : 'From narration'}
          </Chip>
        </div>
      )}
      <Field
        label="What the voice says"
        hint={
          line ? undefined : 'Voiced with the project voice and pronunciations, starting at the playhead.'
        }
      >
        {(id) => (
          <TextArea
            id={id}
            rows={4}
            maxLength={600}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. We add the other two tools the same way."
          />
        )}
      </Field>
      <div className="piece-row">
        {line ? (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={!changed || !!busy}
              onClick={() => void run('voice', () => onEdit({ text: text.trim() }))}
            >
              {busy === 'voice' ? 'Voicing…' : 'Save and voice'}
            </Button>
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() => void run('move', () => onEdit({ at: playhead() }))}
              title="Start this line where the playhead is"
            >
              Move to playhead
            </Button>
            <Button size="sm" variant="danger" disabled={!!busy} onClick={() => void run('remove', onRemove)}>
              Delete
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={!changed || !!busy}
            onClick={() => {
              const at = playhead();
              void run('voice', () => onAdd(text.trim(), at));
            }}
          >
            {busy === 'voice' ? 'Voicing…' : 'Voice it at the playhead'}
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
