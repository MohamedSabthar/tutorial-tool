import { useState, type FormEvent, type RefObject } from 'react';
import type { AgentEvent, AgentStatus as Status, Run } from '@studio/core';
import { AgentStatus, Button, Glyph, IconTile, Inset, LinkButton } from '@studio/ui';
import { agentActivity, toolPhrase } from './model';

type Permission = Extract<AgentEvent, { kind: 'permission' }>;

/** A run's summary in two parts: its first line (the title) and the rest. */
function splitSummary(run: Run) {
  const lines = run.summary.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = (lines[0] ?? 'The agent changed this tutorial').replace(/^#+\s*/, '').slice(0, 140);
  const body = lines.slice(1).join(' ').slice(0, 280);
  return { title, body };
}

/**
 * Under the video, always there: what the agent is doing (with Stop), what it waits for you
 * to allow, what it just changed (Keep / Undo this / Tell it more), and the box to ask it.
 */
export function AgentDock({
  slug,
  status,
  events,
  run,
  notes,
  composer,
  draft,
  onDraft,
  onSend,
  onStop,
  onAnswer,
  onKeep,
  onUndoRun,
  onFollowUp,
  onPin,
  onOpenNote,
  batchOpen,
  onBatchOpen,
  frameUrl,
}: {
  slug: string;
  status: Status | null;
  events: AgentEvent[];
  /** The latest run waiting for review. */
  run: Run | null;
  /** The batch: notes on the video not sent yet, each with its own message, in time order. */
  notes: { id: string; label: string; text: string }[];
  /** Goes to a note and opens it on the video. */
  onOpenNote: (id: string) => void;
  /** Whether the batch list is open (its pins then stay on the video). */
  batchOpen: boolean;
  onBatchOpen: (open: boolean) => void;
  composer: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onAnswer: (requestId: string, allow: boolean) => void;
  onKeep: (run: Run) => void;
  onUndoRun: (run: Run) => void;
  onFollowUp: (run: Run, text: string) => void;
  onPin: () => void;
  frameUrl: (rel: string) => string | null;
}) {
  const [followUp, setFollowUp] = useState(false);
  const [compare, setCompare] = useState<'before' | 'after'>('after');
  const working = status?.state === 'busy' || status?.state === 'starting' || status?.state === 'interrupting';
  const pending = new Set(status?.pending ?? []);
  const waiting = events.filter((e): e is Permission => e.kind === 'permission' && pending.has(e.requestId));
  const activity = agentActivity(events);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if ((!text && !notes.length) || working) return;
    if (followUp && run) {
      onFollowUp(run, text);
      setFollowUp(false);
    } else onSend(text);
  };
  const frames = run ? Object.values(run.frames).find((f) => f.before || f.after) : undefined;
  const shown = frames ? (compare === 'before' ? frames.before : frames.after) ?? frames.after ?? frames.before : undefined;
  const result = run && !working ? splitSummary(run) : null;

  return (
    <div className="ed-dock">
      {working && (
        <div className="ed-dockbox k-enter">
          <div className="k-panel ed-dock-status">
            <AgentStatus
              label={status?.state === 'interrupting' ? 'Stopping…' : waiting.length ? 'Waiting for your OK' : activity.label}
              since={activity.since}
              steps={activity.steps}
              onStop={status?.state === 'interrupting' ? undefined : onStop}
            />
          </div>
        </div>
      )}

      {waiting.map((p) => (
        <div key={p.requestId} className="ed-approve k-enter" role="alert">
          <div className="k-panel ed-approve-in">
            <div className="ed-row-c">
              <IconTile icon="lock" tone="warning" />
              <div className="ed-grow">
                <b className="ed-b">Allow the agent to {toolPhrase(p.tool, p.summary).toLowerCase()}?</b>
                <p className="ed-muted ed-s13">{p.reason ?? 'It needs your OK before it does this.'}</p>
              </div>
            </div>
            <details className="ed-details">
              <summary>Details</summary>
              <Inset className="ed-details-in">
                <code>{p.tool}</code> {p.summary}
              </Inset>
            </details>
            <div className="ed-row">
              <Button variant="brand" onClick={() => onAnswer(p.requestId, true)}>
                Allow
              </Button>
              <Button onClick={() => onAnswer(p.requestId, false)}>Not now</Button>
            </div>
          </div>
        </div>
      ))}

      {result && run && (
        <div className="ed-dockbox k-enter" role="status">
          <div className="k-panel ed-result">
            <div className="ed-row-c">
              <IconTile icon="check" tone="positive" />
              <div className="ed-grow">
                <b className="ed-b">{result.title}</b>
                {result.body && <p className="ed-muted ed-s13">{result.body}</p>}
              </div>
              {frames && (
                <div className="ui-seg" role="group" aria-label="Compare">
                  {(['before', 'after'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="ui-seg-item"
                      aria-pressed={compare === k}
                      disabled={!frames[k]}
                      onClick={() => setCompare(k)}
                    >
                      {k === 'before' ? 'Before' : 'After'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {shown && frameUrl(shown) && (
              <img className="ed-result-frame" src={frameUrl(shown)!} alt={compare === 'before' ? 'Before the change' : 'After the change'} />
            )}
            <div className="ed-row">
              <Button variant="silver" onClick={() => onKeep(run)}>
                <Glyph name="check" size={12} />
                Keep
              </Button>
              <Button onClick={() => onUndoRun(run)}>
                <Glyph name="undo" size={12} />
                Undo this
              </Button>
              <Button
                variant="quiet"
                aria-pressed={followUp}
                onClick={() => {
                  setFollowUp(true);
                  composer.current?.focus();
                }}
              >
                Tell it more…
              </Button>
            </div>
            <details className="ed-details">
              <summary>Details</summary>
              <Inset className="ed-details-in">
                {run.timeline.length > 0 && (
                  <ul>
                    {run.timeline.slice(0, 12).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                )}
                {run.files.length > 0 && (
                  <ul className="ed-mono">
                    {run.files.map((f) => (
                      <li key={f.path}>
                        {f.path} <span className="ed-pos">+{f.added}</span> <span className="ed-neg">−{f.removed}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {run.checks.length > 0 && (
                  <ul>
                    {run.checks.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
                <p className="ed-muted ed-s12">
                  Run #{run.n} · {Math.round(run.durationMs / 1000)} s · ${run.costUsd.toFixed(2)}
                </p>
                <LinkButton size="sm" variant="quiet" href={`#/agentfix/${slug}?run=${run.n}`}>
                  Open the full review (diff and frames)
                </LinkButton>
              </Inset>
            </details>
          </div>
        </div>
      )}

      <form className="ed-dockbox" onSubmit={submit}>
        {notes.length > 0 && batchOpen && (
          <ol className="ed-notes" id="ed-batch" aria-label="Notes in this batch">
            {notes.map((n, i) => {
              const first = n.text.trim().split('\n')[0] ?? '';
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className="ed-noterow"
                    data-empty={!first || undefined}
                    onClick={() => onOpenNote(n.id)}
                    aria-label={`Note ${i + 1} at ${n.label}: ${first || 'no message yet'}. Open it`}
                  >
                    <span className="ed-notecard-n" data-empty={!first || undefined}>
                      {i + 1}
                    </span>
                    <span className="ed-tab ed-muted">{n.label}</span>
                    <span className="ed-noterow-t">{first || 'Needs a message'}</span>
                    {!first && <Glyph name="warn" size={12} />}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="ed-dockin">
          <span className="ed-dock-spark" aria-hidden="true">
            <Glyph name="spark" size={16} />
          </span>
          <label className="ed-sr" htmlFor="ed-ask">
            {followUp && run ? `Tell the agent more about run ${run.n}` : 'Ask the agent'}
          </label>
          <textarea
            id="ed-ask"
            ref={composer}
            rows={1}
            value={draft}
            placeholder={
              followUp && run
                ? 'What should it change about this?'
                : notes.length
                  ? 'Anything else? (optional)'
                  : 'Ask the agent to change anything… e.g. “Add an arrow at Create in step 3”'
            }
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape' && followUp) setFollowUp(false);
            }}
          />
          <button
            type="button"
            className="ui-btn ui-btn-quiet ui-icon-btn"
            aria-label="Point at the video"
            title="Point at the video: click the spot the agent should look at"
            onClick={onPin}
          >
            <Glyph name="pin" size={16} />
          </button>
          {notes.length > 0 && !followUp ? (
            <button
              type="button"
              className="ui-btn ui-btn-quiet ui-btn-sm"
              aria-expanded={batchOpen}
              aria-controls="ed-batch"
              onClick={() => onBatchOpen(!batchOpen)}
            >
              Review batch
            </button>
          ) : (
            <button type="submit" className="ed-send" aria-label="Send to the agent" disabled={working || !draft.trim()}>
              <Glyph name="send" size={16} />
            </button>
          )}
        </div>
        {notes.length > 0 && !followUp && (
          <button type="submit" className="ui-btn ui-btn-brand ui-btn-lg ui-btn-block ed-send-batch" disabled={working}>
            <Glyph name="send" size={14} />
            Send batch ({notes.length} note{notes.length === 1 ? '' : 's'})
          </button>
        )}
      </form>
    </div>
  );
}
