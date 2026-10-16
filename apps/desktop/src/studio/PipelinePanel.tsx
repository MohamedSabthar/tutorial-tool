import { useState } from 'react';
import { Button, Chip, GateBanner, Panel, Stepper, Switch, TextArea, type ChipTone } from '@studio/ui';
import type { PipelineStatus } from '@studio/core';
import { pipelineSteps, usePipeline } from '../pipeline';
import { DiffView } from './DiffView';

const STATUS: Record<PipelineStatus, { label: string; tone: ChipTone }> = {
  idle: { label: 'Not started', tone: 'neutral' },
  running: { label: 'Running', tone: 'active' },
  waiting: { label: 'Needs you', tone: 'info' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'error' },
  stopped: { label: 'Stopped', tone: 'neutral' },
};

/**
 * Runs the production pipeline from the brief (the project's CLAUDE.md): the stage stepper,
 * the storyboard gate with the planned steps, and help requests from the agent.
 */
export function PipelinePanel({ slug }: { slug: string }) {
  const p = usePipeline(slug);
  const [feedback, setFeedback] = useState('');
  const [storyboardGate, setStoryboardGate] = useState(true);
  const s = p.state;
  const status = s?.status ?? 'idle';
  const active = status === 'running' || status === 'waiting';

  return (
    <Panel title="Pipeline" action={<Chip tone={STATUS[status].tone}>{STATUS[status].label}</Chip>}>
      <Stepper steps={pipelineSteps(s)} />

      {s?.gate && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <GateBanner title={s.gate.title} text={s.gate.text} />
          {s.gate.kind === 'storyboard' && s.plan && (
            <ol
              aria-label="Planned steps"
              style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}
            >
              {s.plan.steps.map((st) => (
                <li key={st.id} style={{ marginBottom: 6 }}>
                  <strong style={{ color: 'var(--ui-navy)' }}>{st.title}</strong>
                  {st.action && <div style={{ color: 'var(--ui-gray-600)' }}>{st.action}</div>}
                  {st.narration && <div style={{ fontStyle: 'italic' }}>“{st.narration}”</div>}
                </li>
              ))}
              {s.plan.explainers.map((e, i) => (
                <li key={`x${i}`} style={{ listStyle: 'none', color: 'var(--ui-steel)' }}>
                  Explainer after {e.after}: {e.idea}
                </li>
              ))}
            </ol>
          )}
          {s.gate.kind === 'knowledge' && s.gate.diff && <DiffView diff={s.gate.diff} />}
          <TextArea
            aria-label="Feedback for the agent"
            rows={2}
            value={feedback}
            placeholder="What should the agent change?"
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="primary" disabled={!p.ready} onClick={() => void p.approve()}>
              {s.gate.kind === 'storyboard'
                ? 'Approve'
                : s.gate.kind === 'knowledge'
                  ? 'Commit'
                  : 'Try again'}
            </Button>
            <Button
              size="sm"
              variant="steel"
              disabled={!p.ready || !feedback.trim()}
              onClick={() => {
                void p.revise(feedback.trim());
                setFeedback('');
              }}
            >
              Revise with agent
            </Button>
            {s.gate.kind === 'knowledge' && (
              <Button size="sm" variant="ghost" disabled={!p.ready} onClick={() => void p.revise('discard')}>
                Discard
              </Button>
            )}
          </div>
        </div>
      )}

      {s?.error && <Chip tone="error">{s.error}</Chip>}
      {p.error && <Chip tone="error">{p.error}</Chip>}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {active ? (
          <Button size="sm" variant="danger" onClick={() => void p.stop()}>
            Stop pipeline
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={!p.ready}
              onClick={() => void p.start({ storyboard: storyboardGate })}
              title="Plan, script, dry-run and record this tutorial from its brief (CLAUDE.md)"
            >
              {status === 'idle' ? 'Start from brief' : 'Run again'}
            </Button>
            <Switch label="Storyboard review" checked={storyboardGate} onChange={setStoryboardGate} />
          </>
        )}
      </div>
    </Panel>
  );
}
