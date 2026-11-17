import { useEffect, useRef, useState } from 'react';
import { narrationSeconds, type Plan, type PlanEdit } from '@studio/core';
import { Shell, ShellHeader, ShellPanel } from '@studio/ui';
import { formatDuration } from '../frame';
import { storyboardCards } from '../storyboard/StoryboardScreen';

/** Rows that show the whole text at the card's width. */
const rowsFor = (text: string) => Math.max(2, Math.ceil(text.length / 80) + 1);

/** Sends typed edits to the plan: on blur, and before approving or asking for changes. */
export function usePlanEdits(save: (edits: PlanEdit[]) => Promise<void>) {
  const pending = useRef(new Map<string, PlanEdit>());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const flush = async () => {
    if (!pending.current.size) return;
    const edits = [...pending.current.values()];
    pending.current.clear();
    await save(edits);
    setDrafts((d) => {
      const next = { ...d };
      for (const e of edits) delete next[e.op === 'step' ? `${e.id}:${e.field}` : `e${e.index}`];
      return next;
    });
  };
  const edit = (key: string, value: string, e: PlanEdit) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    pending.current.set(key, e);
  };
  // Edits typed but not yet blurred go out when the screen closes.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => void flushRef.current(), []);
  return { drafts, edit, flush };
}

export type PlanEditor = ReturnType<typeof usePlanEdits>;

/**
 * The plan as cards to edit at a check: the words of each step ("Check the script"), or each
 * step's title and what happens on screen ("Check the steps"). Explainers sit between the steps.
 */
export function ScriptReview({
  plan,
  mode,
  editor,
  shot,
}: {
  plan: Plan;
  mode: 'script' | 'steps';
  editor: PlanEditor;
  /** A step's still from the last test, if there is one. */
  shot?: (stepId: string) => string | null;
}) {
  const { drafts, edit, flush } = editor;
  const cards = storyboardCards(plan);
  const steps = cards.filter((c) => c.kind === 'step').length;
  return (
    <Shell aria-label={mode === 'script' ? 'The script' : 'The steps'}>
      <ShellHeader
        icon={mode === 'script' ? 'mic' : 'timeline'}
        title={mode === 'script' ? 'The script' : 'The steps'}
        subtitle={
          mode === 'script'
            ? 'Edit any words here. They become the voice-over.'
            : 'Rename a step or change what happens on screen. The words are written after testing.'
        }
        aside={<span className="mk-count">{steps}</span>}
      />
      <ShellPanel className="mk-review">
        {cards.map((c, i) => {
          if (c.kind === 'explainer') {
            const key = `e${c.index}`;
            const value = drafts[key] ?? c.idea;
            return (
              <div key={key} className="mk-rstep">
                <span className="mk-num" data-kind="explainer" aria-hidden="true">
                  E
                </span>
                <span className="mk-rstep-title">Explainer</span>
                <span className="mk-rstep-dur">≈0:20</span>
                <label className="ui-sr-only" htmlFor={`mk-${key}`}>
                  Explainer idea, item {i + 1}
                </label>
                <textarea
                  id={`mk-${key}`}
                  className="ui-textarea mk-rstep-text"
                  rows={rowsFor(value)}
                  value={value}
                  onChange={(e) =>
                    edit(key, e.target.value, { op: 'explainer', index: c.index, idea: e.target.value })
                  }
                  onBlur={() => void flush()}
                />
              </div>
            );
          }
          const s = c.step;
          if (mode === 'script') {
            const key = `${s.id}:narration`;
            const value = drafts[key] ?? s.narration;
            const img = shot?.(s.id);
            return (
              <div key={s.id} className="mk-rstep">
                <span className="mk-num">{c.n}</span>
                <span className="mk-rstep-title">{s.title}</span>
                <span className="mk-rstep-dur" title="Estimated at about 150 words a minute">
                  ~{formatDuration(Math.round(narrationSeconds(value)))}
                </span>
                <label className="ui-sr-only" htmlFor={`mk-${key}`}>
                  Words for step {c.n}
                </label>
                <div className="mk-rstep-body">
                  <textarea
                    id={`mk-${key}`}
                    className="ui-textarea mk-rstep-text"
                    rows={rowsFor(value)}
                    value={value}
                    placeholder="Nothing is said in this step."
                    onChange={(e) =>
                      edit(key, e.target.value, {
                        op: 'step',
                        id: s.id,
                        field: 'narration',
                        value: e.target.value,
                      })
                    }
                    onBlur={() => void flush()}
                  />
                  {img && (
                    <img
                      className="mk-rstep-shot"
                      src={img}
                      alt={`The screen at the end of step ${c.n} in the test`}
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                </div>
              </div>
            );
          }
          const tKey = `${s.id}:title`;
          const aKey = `${s.id}:action`;
          return (
            <div key={s.id} className="mk-rstep">
              <span className="mk-num">{c.n}</span>
              <label className="ui-sr-only" htmlFor={`mk-${tKey}`}>
                Step {c.n} title
              </label>
              <input
                id={`mk-${tKey}`}
                className="ui-input mk-rstep-name"
                value={drafts[tKey] ?? s.title}
                onChange={(e) =>
                  edit(tKey, e.target.value, { op: 'step', id: s.id, field: 'title', value: e.target.value })
                }
                onBlur={() => void flush()}
              />
              <span />
              <label className="mk-rstep-label" htmlFor={`mk-${aKey}`}>
                On screen
              </label>
              <textarea
                id={`mk-${aKey}`}
                className="ui-textarea mk-rstep-text"
                rows={rowsFor(drafts[aKey] ?? s.action)}
                value={drafts[aKey] ?? s.action}
                onChange={(e) =>
                  edit(aKey, e.target.value, { op: 'step', id: s.id, field: 'action', value: e.target.value })
                }
                onBlur={() => void flush()}
              />
            </div>
          );
        })}
      </ShellPanel>
    </Shell>
  );
}

/** "6 lines · about 1:14 · fits your 2–3 min target" for the script check card. */
export function scriptSummary(
  plan: Plan,
  target: { label: string; seconds: readonly [number, number] },
  drafts: Record<string, string>,
): string {
  const words = plan.steps.map((s) => drafts[`${s.id}:narration`] ?? s.narration).filter((t) => t.trim());
  const secs = Math.round(words.reduce((n, t) => n + narrationSeconds(t), 0) + plan.explainers.length * 20);
  const fit =
    secs < target.seconds[0]
      ? `shorter than your ${target.label} target`
      : secs > target.seconds[1]
        ? `longer than your ${target.label} target`
        : `fits your ${target.label} target`;
  return `${words.length} line${words.length === 1 ? '' : 's'} · about ${formatDuration(secs)} · ${fit}`;
}
