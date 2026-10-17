import { useEffect, useRef, useState } from 'react';
import {
  BRIEF_LENGTHS,
  narrationSeconds,
  PIPELINE_STAGES,
  type Brief,
  type Plan,
  type PlanEdit,
  type Project,
} from '@studio/core';
import { Button, Chip, GateBanner, LinkButton, Panel, Stepper, TextArea } from '@studio/ui';
import { openLiveWindow, useEngine } from '../../engine';
import { pipelineSteps, usePipeline } from '../../pipeline';
import { AppFrame, formatDuration } from '../frame';

/** Rough length of an explainer until scenes exist (Phase 6). */
const EXPLAINER_SECONDS = 20;
const MIN_STEP_SECONDS = 5;

type Card =
  | { kind: 'step'; n: number; step: Plan['steps'][number]; seconds: number }
  | { kind: 'explainer'; index: number; idea: string; seconds: number };

/** Step cards in order, with each proposed explainer after the step it follows. */
export function storyboardCards(plan: Plan): Card[] {
  const explainers = plan.explainers.map((e, index) => ({ ...e, index }));
  const ex = (e: (typeof explainers)[number]): Card => ({
    kind: 'explainer',
    index: e.index,
    idea: e.idea,
    seconds: EXPLAINER_SECONDS,
  });
  const ids = new Set(plan.steps.map((s) => s.id));
  const cards: Card[] = explainers.filter((e) => e.after === 'start').map(ex);
  plan.steps.forEach((step, i) => {
    cards.push({
      kind: 'step',
      n: i + 1,
      step,
      seconds: Math.max(MIN_STEP_SECONDS, Math.round(narrationSeconds(step.narration))),
    });
    cards.push(...explainers.filter((e) => e.after === step.id).map(ex));
  });
  // Explainers that name an unknown step go at the end rather than disappear.
  cards.push(...explainers.filter((e) => e.after !== 'start' && !ids.has(e.after)).map(ex));
  return cards;
}

export function StoryboardScreen({ slug }: { slug: string }) {
  const { client, state: conn } = useEngine();
  const pipe = usePipeline(slug);
  const [project, setProject] = useState<Project | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, PlanEdit>());

  useEffect(() => {
    if (!client || conn !== 'open') return;
    void Promise.all([client.call('project.open', { slug }), client.call('brief.get', { slug })]).then(
      ([open, b]) => {
        setProject(open.project);
        setBrief(b);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [client, conn, slug]);

  const st = pipe.state;
  const plan = st?.plan ?? null;
  const reviewing = st?.status === 'waiting' && st.gate?.kind === 'storyboard';
  const cards = plan ? storyboardCards(plan) : [];

  /** Sends edits typed since the last flush (on blur, and before approving or revising). */
  const flush = async () => {
    if (!client || !pending.current.size) return;
    const edits = [...pending.current.values()];
    pending.current.clear();
    try {
      await client.call('pipeline.editPlan', { slug, edits });
      setDrafts((d) => {
        const next = { ...d };
        for (const e of edits) delete next[e.op === 'step' ? `${e.id}:${e.field}` : `e${e.index}`];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const edit = (key: string, value: string, e: PlanEdit) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    pending.current.set(key, e);
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await flush();
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const total = cards.reduce((n, c) => n + c.seconds, 0);
  const target = BRIEF_LENGTHS.find((l) => l.value === (brief?.length ?? 'medium'))!;
  const stageLabel = PIPELINE_STAGES.find((s) => s.stage === st?.stage)?.label ?? '';
  const steps = cards.filter((c) => c.kind === 'step').length;
  const explainers = cards.length - steps;

  const banner = (() => {
    if (!st) return null;
    if (reviewing)
      return (
        <GateBanner
          title="Storyboard gate: the agent is paused for your review"
          text={`${steps} recorded step${steps === 1 ? '' : 's'} and ${explainers} explainer${explainers === 1 ? '' : 's'}. Edit narration in place, or ask for changes. Recording starts after you approve.`}
          actions={
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await pipe.approve();
                  await openLiveWindow();
                })
              }
            >
              Approve and record →
            </Button>
          }
        />
      );
    if (st.status === 'waiting' && st.gate)
      return (
        <GateBanner
          title={st.gate.title}
          text={st.gate.text}
          actions={
            <>
              <Button onClick={() => void openLiveWindow()}>Open Live</Button>
              <LinkButton variant="primary" href={`#/studio/${slug}`}>
                Review in the Studio
              </LinkButton>
            </>
          }
        />
      );
    if (st.status === 'running')
      return (
        <div role="status" className="storyboard-status">
          <span className="storyboard-pulse" aria-hidden="true" />
          <span>
            <strong>
              {st.stage === 'plan'
                ? plan
                  ? 'The agent is revising the storyboard…'
                  : 'The agent is planning the steps…'
                : `Approved. ${stageLabel}…`}
            </strong>{' '}
            {st.stage === 'plan'
              ? 'The storyboard appears here for your review.'
              : 'Watch it in the Live window.'}
          </span>
          <span style={{ flex: 1 }} />
          <Button size="sm" onClick={() => void openLiveWindow()}>
            Open Live
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void pipe.stop()}>
            Stop
          </Button>
        </div>
      );
    if (st.status === 'done')
      return (
        <div role="status" className="storyboard-status" data-tone="ok">
          <span>
            <strong>Recorded.</strong> The take and narration are ready to edit.
          </span>
          <span style={{ flex: 1 }} />
          <LinkButton size="sm" variant="primary" href={`#/studio/${slug}`}>
            Open in the Studio
          </LinkButton>
        </div>
      );
    if (st.status === 'failed' || st.status === 'stopped')
      return (
        <div role="alert" className="storyboard-status" data-tone="error">
          <span>
            <strong>{st.status === 'failed' ? 'The pipeline failed.' : 'The pipeline was stopped.'}</strong>{' '}
            {st.error ?? ''}
          </span>
          <span style={{ flex: 1 }} />
          <LinkButton size="sm" href={`#/brief/${slug}`}>
            Edit the brief
          </LinkButton>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void pipe.start({ storyboard: brief?.gates.storyboard ?? true })}
          >
            Start again
          </Button>
        </div>
      );
    return null;
  })();

  return (
    <AppFrame current="projects" slug={slug} banner={banner}>
      <div className="storyboard">
        <main className="storyboard-cards" aria-label="Storyboard">
          <div className="storyboard-head">
            <h1 className="storyboard-title">{project?.title ?? slug}</h1>
            {plan?.summary && <p className="storyboard-summary">{plan.summary}</p>}
          </div>
          {(error ?? pipe.error) && (
            <span role="alert" className="app-error">
              {error ?? pipe.error}
            </span>
          )}
          {!plan && (
            <div className="storyboard-empty">
              {st?.status === 'idle' ? (
                <>
                  No plan yet. <a href={`#/brief/${slug}`}>Fill in the brief</a> and choose Plan and record.
                </>
              ) : (
                'The storyboard appears here when the agent saves its plan.'
              )}
            </div>
          )}
          {cards.map((c) =>
            c.kind === 'step' ? (
              <article key={c.step.id} className="sb-card" aria-label={`Step ${c.n}: ${c.step.title}`}>
                <div className="sb-card-head">
                  <span className="sb-badge ui-mono">{c.n}</span>
                  <span className="sb-card-title">{c.step.title}</span>
                  <Chip tone="info">Recorded step</Chip>
                  <span style={{ flex: '1 1 10px' }} />
                  <span
                    className="sb-dur ui-mono"
                    title="Estimated from the narration at about 150 words per minute"
                  >
                    {formatDuration(c.seconds)}
                  </span>
                </div>
                <label className="sb-label">
                  Narration
                  <TextArea
                    rows={2}
                    readOnly={!reviewing}
                    value={drafts[`${c.step.id}:narration`] ?? c.step.narration}
                    onChange={(e) =>
                      edit(`${c.step.id}:narration`, e.target.value, {
                        op: 'step',
                        id: c.step.id,
                        field: 'narration',
                        value: e.target.value,
                      })
                    }
                    onBlur={() => void flush()}
                  />
                </label>
                {c.step.action && (
                  <span className="sb-visual">
                    <b>On screen:</b> {c.step.action}
                  </span>
                )}
              </article>
            ) : (
              <article key={`e${c.index}`} className="sb-card sb-card-explainer" aria-label="Explainer">
                <div className="sb-card-head">
                  <span className="sb-badge sb-badge-explainer ui-mono">E</span>
                  <span className="sb-card-title">Proposed explainer</span>
                  <Chip tone="active">Explainer</Chip>
                  <span style={{ flex: '1 1 10px' }} />
                  <span className="sb-dur ui-mono" title="A rough length until the scene is designed">
                    ≈{formatDuration(c.seconds)}
                  </span>
                </div>
                <label className="sb-label">
                  Idea
                  <TextArea
                    rows={2}
                    readOnly={!reviewing}
                    value={drafts[`e${c.index}`] ?? c.idea}
                    onChange={(e) =>
                      edit(`e${c.index}`, e.target.value, {
                        op: 'explainer',
                        index: c.index,
                        idea: e.target.value,
                      })
                    }
                    onBlur={() => void flush()}
                  />
                </label>
                <span className="sb-visual">
                  <b>Scene:</b> designed after the recording, with the explainer tools.
                </span>
              </article>
            ),
          )}
        </main>

        <aside className="storyboard-side">
          <Panel title="Timing">
            <span
              className="sb-total"
              data-off={total < target.seconds[0] || total > target.seconds[1] ? 'true' : undefined}
            >
              {formatDuration(total)}
            </span>
            <span className="brief-muted">
              Target: {target.label} · narration ≈ 150 wpm
              {total > target.seconds[1] && plan
                ? ` · about ${formatDuration(total - target.seconds[1])} over`
                : ''}
              {total < target.seconds[0] && plan
                ? ` · about ${formatDuration(target.seconds[0] - total)} under`
                : ''}
            </span>
            <div className="sb-bar" aria-hidden="true">
              {cards.map((c) => (
                <span
                  key={c.kind === 'step' ? c.step.id : `e${c.index}`}
                  title={c.kind === 'step' ? `Step ${c.n}` : 'Explainer'}
                  data-kind={c.kind}
                  style={{ flex: `${c.seconds} 1 0` }}
                />
              ))}
            </div>
            <div className="sb-legend">
              <span>
                <span className="sb-swatch" data-kind="step" />
                Recorded steps
              </span>
              <span>
                <span className="sb-swatch" data-kind="explainer" />
                Explainer
              </span>
            </div>
          </Panel>
          <Panel title="Ask for changes">
            <label htmlFor="sb-feedback" className="brief-muted">
              The agent revises the storyboard before anything is recorded.
            </label>
            <TextArea
              id="sb-feedback"
              rows={4}
              value={feedback}
              disabled={!reviewing}
              placeholder="Add a short recap explainer at the end comparing GET and POST resources."
              onChange={(e) => setFeedback(e.target.value)}
            />
            <Button
              disabled={!reviewing || !feedback.trim() || busy}
              onClick={() =>
                void act(async () => {
                  await pipe.revise(feedback.trim());
                  setFeedback('');
                })
              }
            >
              Revise with agent
            </Button>
          </Panel>
          {st && st.status !== 'idle' && (
            <Panel title="Pipeline">
              <Stepper steps={pipelineSteps(st)} />
            </Panel>
          )}
        </aside>
      </div>
    </AppFrame>
  );
}
