import { useId, useState, type ReactNode } from 'react';
import type { Gate, LateCueFix } from '@studio/core';
import { Button, Glyph, IconTile, Inset, ShellPanel, Tag, useToast, type GlyphName } from '@studio/ui';
import { describeTool } from './feedRows';
import type { PermissionEvent } from './model';

/** An amber card at the top of the right column: something waits for the user. */
export function NeedsYouCard({
  icon,
  title,
  subtitle,
  aside,
  children,
  alert = false,
}: {
  icon: GlyphName;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  alert?: boolean;
}) {
  const id = useId();
  return (
    <section className="mk-need k-enter" aria-labelledby={id} role={alert ? 'alert' : undefined}>
      <ShellPanel className="mk-need-panel">
        <div className="mk-need-head">
          <IconTile icon={icon} tone="warning" />
          <div className="mk-need-text">
            <h2 id={id}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {aside}
        </div>
        {children}
      </ShellPanel>
    </section>
  );
}

/** A disclosure for the technical side (IDs, raw errors, diffs). */
export function Details({ children, label = 'Details' }: { children: ReactNode; label?: string }) {
  return (
    <details className="mk-details">
      <summary>{label}</summary>
      <Inset className="mk-details-body">{children}</Inset>
    </details>
  );
}

/** "Or ask for changes": feedback the agent revises with. A secondary, full-width Send, then a confirmation. */
export function AskForChanges({
  placeholder,
  disabled,
  onSend,
  label = 'Or ask for changes',
  sent = 'Sent to the agent. It is working on your changes.',
}: {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => Promise<void> | void;
  label?: string;
  /** What the confirmation says once it is sent. */
  sent?: string;
}) {
  const id = useId();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setDone(false);
    Promise.resolve(onSend(t))
      .then(() => {
        setText('');
        setDone(true);
        toast(sent);
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: 'error' }))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mk-ask">
      <label htmlFor={id} className="mk-ask-label">
        {label}
      </label>
      <textarea
        id={id}
        className="ui-textarea"
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setDone(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      <Button size="lg" className="ui-btn-block" disabled={disabled || busy || !text.trim()} onClick={send}>
        <Glyph name="send" size={14} />
        {busy ? 'Sending…' : 'Send'}
      </Button>
      {done && (
        <p className="ui-sent" role="status">
          <Glyph name="check" size={12} />
          {sent}
        </p>
      )}
    </div>
  );
}

/** A tool call that waits for Allow or Deny. */
export function PermissionCard({
  request,
  autoMode,
  disabled,
  onAnswer,
  onAllowSafe,
}: {
  request: PermissionEvent;
  autoMode: boolean;
  disabled?: boolean;
  onAnswer: (allow: boolean) => void;
  onAllowSafe: () => void;
}) {
  const id = useId();
  const [always, setAlways] = useState(false);
  const what = describeTool(request.tool, request.summary);
  return (
    <NeedsYouCard
      alert
      icon="lock"
      title={`Allow ${what}?`}
      subtitle="It paused before doing this. Nothing happens until you decide."
      aside={<Tag>{request.tool}</Tag>}
    >
      {request.reason && <Inset className="mk-need-note">{request.reason}</Inset>}
      <div className="mk-need-row">
        <Button
          variant="brand"
          disabled={disabled}
          onClick={() => {
            if (always) onAllowSafe();
            onAnswer(true);
          }}
        >
          Allow
        </Button>
        <Button disabled={disabled} onClick={() => onAnswer(false)}>
          Deny
        </Button>
        <span className="mk-grow" />
        {!autoMode && (
          <label htmlFor={id} className="mk-check">
            <input id={id} type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
            Allow safe actions for this tutorial
          </label>
        )}
      </div>
      <Details>
        <div>tool: {request.tool}</div>
        <div>input: {request.summary}</div>
        <div>request: {request.requestId}</div>
      </Details>
    </NeedsYouCard>
  );
}

/** "Check the script" or "Check the steps": approve, or ask for changes. */
export function ReviewCard({
  kind,
  summary,
  disabled,
  onApprove,
  onRevise,
}: {
  kind: 'script' | 'steps';
  summary: string;
  disabled?: boolean;
  onApprove: () => void;
  onRevise: (text: string) => Promise<void>;
}) {
  return (
    <NeedsYouCard
      icon={kind === 'script' ? 'mic' : 'timeline'}
      title={kind === 'script' ? 'Check the script' : 'Check the steps'}
      subtitle={summary}
    >
      <Button variant="brand" size="lg" disabled={disabled} onClick={onApprove}>
        {kind === 'script' ? 'Approve and record' : 'Approve and test the steps'}
      </Button>
      <AskForChanges
        disabled={disabled}
        onSend={onRevise}
        placeholder={
          kind === 'script'
            ? 'Shorter intro, and say “base path” in step 3'
            : 'Add a step that runs the service, and drop the recap'
        }
      />
    </NeedsYouCard>
  );
}

/** One late action in plain words. */
function cueLine(c: LateCueFix): string {
  const fix =
    c.rate === null
      ? 'the edit can’t fix this one'
      : c.left > 0.15
        ? `the edit makes it ${c.left.toFixed(1)} s late`
        : 'the edit puts it on its word';
  return `Step ${c.stepId.replace(/^s/, '')}: the click on “${c.word}” is ${c.late.toFixed(1)} s late; ${fix}.`;
}

/** Clicks that happen after the narrator mentions them: fix in the edit or record again. */
export function CuesCard({
  gate,
  disabled,
  onChoose,
}: {
  gate: Gate;
  disabled?: boolean;
  onChoose: (choice: string, remember: boolean) => void;
}) {
  const id = useId();
  const [remember, setRemember] = useState(false);
  const cues = gate.cues ?? [];
  const fixable = cues.filter((c) => c.rate !== null && c.left <= 0.15).length;
  const n = cues.length;
  return (
    <NeedsYouCard
      icon="warn"
      title={`${n} click${n === 1 ? '' : 's'} happen${n === 1 ? 's' : ''} after the narrator mentions ${n === 1 ? 'it' : 'them'}`}
      subtitle={
        fixable === n
          ? 'The edit can put every one on its word. Or record again with the timing fixed.'
          : `The edit can put ${fixable} of ${n} on their words. Recording again fixes the timing first.`
      }
    >
      <ul className="mk-cues" aria-label="Clicks that land late">
        {cues.map((c, i) => (
          <li key={`${c.stepId}-${i}`}>{cueLine(c)}</li>
        ))}
      </ul>
      <div className="mk-need-row">
        {(gate.choices ?? []).map((c, i) => (
          <Button
            key={c.id}
            variant={i === 0 ? 'brand' : 'secondary'}
            disabled={disabled}
            onClick={() => onChoose(c.id, remember)}
          >
            {c.label}
          </Button>
        ))}
        <span className="mk-grow" />
        {gate.remember && (
          <label htmlFor={id} className="mk-check">
            <input
              id={id}
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Don’t ask again
          </label>
        )}
      </div>
      <Details>
        {cues.map((c, i) => (
          <div key={i}>
            {c.stepId} “{c.word}” late {c.late.toFixed(2)} s · {c.gap.toFixed(1)} s after {c.after} · rate{' '}
            {c.rate ?? '—'} · left {c.left.toFixed(2)} s
          </div>
        ))}
      </Details>
    </NeedsYouCard>
  );
}

/** The agent couldn't carry on: its explanation, Try again, or tell it what to do. */
export function HelpCard({
  gate,
  image,
  disabled,
  onApprove,
  onChoose,
  onRevise,
}: {
  gate: Gate;
  image: string | null;
  disabled?: boolean;
  onApprove: () => void;
  onChoose: (choice: string, remember: boolean) => void;
  onRevise: (text: string) => Promise<void>;
}) {
  const said = gate.text
    .split(/\n\n+/)
    .filter((p) => !/^(Reply with|Choose Try again)/.test(p))
    .join('\n\n');
  const cost = /cost limit/i.test(gate.title);
  return (
    <NeedsYouCard
      icon="help"
      title={cost ? 'It reached your cost limit' : 'The agent needs your help'}
      subtitle={cost ? 'Carry on anyway, or stop here.' : 'Tell it what to change, or let it try again.'}
    >
      <Inset className="mk-need-note">{said || gate.text}</Inset>
      {image && <img className="mk-need-image" src={image} alt="The screen when it stopped" />}
      {gate.choices?.length ? (
        <div className="mk-need-row">
          {gate.choices.map((c, i) => (
            <Button
              key={c.id}
              variant={i === 0 ? 'brand' : 'secondary'}
              disabled={disabled}
              onClick={() => onChoose(c.id, false)}
            >
              {c.label}
            </Button>
          ))}
        </div>
      ) : (
        <Button variant="brand" disabled={disabled} onClick={onApprove}>
          {cost ? 'Carry on' : 'Try again'}
        </Button>
      )}
      {!cost && (
        <AskForChanges
          disabled={disabled}
          onSend={onRevise}
          label="Or tell it what to do"
          placeholder="The button is in the agent menu now; open that first"
        />
      )}
      <Details>
        <div className="mk-pre">{gate.title}</div>
        <div className="mk-pre">{gate.text}</div>
      </Details>
    </NeedsYouCard>
  );
}

/** The lessons the agent wrote down for next time: save them, or ask for changes. */
export function KnowledgeCard({
  gate,
  disabled,
  onApprove,
  onRevise,
}: {
  gate: Gate;
  disabled?: boolean;
  onApprove: () => void;
  onRevise: (text: string) => Promise<void>;
}) {
  return (
    <NeedsYouCard
      icon="spark"
      title="Save what it learned?"
      subtitle="Lessons it wrote down so the next tutorial goes faster."
    >
      <Inset className="mk-need-note">{gate.text}</Inset>
      <Button variant="brand" disabled={disabled} onClick={onApprove}>
        Save what it learned
      </Button>
      <AskForChanges disabled={disabled} onSend={onRevise} placeholder="Leave out the note about timing" />
      {gate.diff && (
        <Details label="Details: the changes">
          <pre className="mk-diff">
            {gate.diff.split('\n').map((l, i) => (
              <span
                key={i}
                data-line={
                  l.startsWith('+') && !l.startsWith('+++')
                    ? 'add'
                    : l.startsWith('-') && !l.startsWith('---')
                      ? 'del'
                      : undefined
                }
              >
                {l}
                {'\n'}
              </span>
            ))}
          </pre>
        </Details>
      )}
    </NeedsYouCard>
  );
}

/**
 * Steer the agent while it works, forcefully: it stops what it is doing (its turn, a dry run or
 * a recording) and works from the steer; at a review it is the requested change.
 */
export function SteerCard({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => Promise<'now' | 'next'>;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setNote(null);
    onSend(t)
      .then((when) => {
        setText('');
        setNote({
          text:
            when === 'now'
              ? 'Sent. The agent stopped what it was doing and works from this now.'
              : 'Saved. The agent gets it as soon as the voice-over is made.',
        });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : String(e), error: true }))
      .finally(() => setBusy(false));
  };
  return (
    <section className="mk-steer" aria-labelledby={id}>
      <ShellPanel className="mk-need-panel">
        <div className="mk-ask">
          <label id={id} htmlFor={`${id}-t`} className="mk-steer-label">
            Steer the agent
          </label>
          <textarea
            id={`${id}-t`}
            className="ui-textarea"
            rows={2}
            maxLength={4000}
            value={text}
            placeholder="Use the Default model provider, and keep the agent name short"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button size="lg" variant="brand" className="ui-btn-block" disabled={disabled || busy || !text.trim()} onClick={send}>
            <Glyph name="send" size={14} />
            {busy ? 'Sending…' : 'Send now'}
          </Button>
          {note && (
            <p className={note.error ? 'mk-error' : 'ui-sent'} role={note.error ? 'alert' : 'status'}>
              {!note.error && <Glyph name="check" size={12} />}
              {note.text}
            </p>
          )}
        </div>
      </ShellPanel>
    </section>
  );
}
