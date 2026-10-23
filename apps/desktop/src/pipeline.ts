import { useCallback, useEffect, useState } from 'react';
import { PIPELINE_STAGES, type PipelineState } from '@studio/core';
import {
  IconAlign,
  IconDryRun,
  IconNarrate,
  IconPlan,
  IconPost,
  IconQa,
  IconRecord,
  IconRepair,
  IconRetro,
  IconReview,
  IconScript,
  IconVoice,
  type StepperStep,
  type StepState,
} from '@studio/ui';
import type { PipelineStage } from '@studio/core';
import { useEngine } from './engine';

/**
 * A project's pipeline as seen from a window. Pass `null` to follow whichever project's
 * pipeline changes (the Live window).
 */
export function usePipeline(slug: string | null) {
  const { client, state: conn } = useEngine();
  const [state, setState] = useState<PipelineState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || conn !== 'open') return;
    let live = true;
    if (slug)
      void Promise.resolve().then(async () => {
        try {
          const s = await client.call('pipeline.get', { slug });
          if (live) setState(s);
        } catch (e) {
          if (live) setError(e instanceof Error ? e.message : String(e));
        }
      });
    const off = client.on('pipeline.changed', (s) => {
      if (!slug || s.slug === slug) setState(s);
    });
    return () => {
      live = false;
      off();
    };
  }, [client, conn, slug]);

  const act = useCallback(async (fn: () => Promise<PipelineState>) => {
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  const target = slug ?? state?.slug ?? null;

  return {
    state,
    error,
    ready: !!client && conn === 'open' && !!target,
    start: (gates?: { storyboard?: boolean; narration?: boolean }) =>
      act(() => client!.call('pipeline.start', { slug: target!, ...(gates ? { gates } : {}) })),
    approve: () => act(() => client!.call('pipeline.approve', { slug: target! })),
    revise: (feedback: string) => act(() => client!.call('pipeline.revise', { slug: target!, feedback })),
    stop: () => act(() => client!.call('pipeline.stop', { slug: target! })),
    resume: () => act(() => client!.call('pipeline.resume', { slug: target! })),
  };
}

/** Whether a stage has run in this pipeline. */
const ran = (history: PipelineState['history'], stage: string) => history.some((h) => h.stage === stage);

/**
 * Stepper rows for the pipeline. Repair shows once it has run; narrate and voice (voice-first
 * pacing) are hidden in a finished run that skipped them.
 */
/** Each stage's icon in the stepper. */
const STAGE_ICON: Record<PipelineStage, (p: { size?: number }) => StepperStep['icon']> = {
  plan: IconPlan,
  storyboard_gate: IconReview,
  script: IconScript,
  dry_run: IconDryRun,
  repair: IconRepair,
  narrate: IconNarrate,
  voice: IconVoice,
  align: IconAlign,
  record: IconRecord,
  post: IconPost,
  qa: IconQa,
  retro: IconRetro,
};

export function pipelineSteps(state: PipelineState | null): StepperStep[] {
  const history = state?.history ?? [];
  return PIPELINE_STAGES.filter((s) =>
    s.stage === 'repair'
      ? ran(history, 'repair')
      : s.stage === 'narrate' || s.stage === 'voice' || s.stage === 'align'
        ? ran(history, s.stage) || state?.status !== 'done'
        : s.stage === 'storyboard_gate'
          ? ran(history, s.stage) || !!state?.gates.storyboard
          : true,
  ).map(({ stage, label }) => {
    const runs = history.filter((h) => h.stage === stage);
    const last = runs.at(-1);
    const current = state?.stage === stage;
    let st: StepState = 'todo';
    if (current && state?.status === 'waiting') st = 'gate';
    else if (current && state?.status === 'running') st = 'active';
    else if (last?.ok === false && !current) st = 'failed';
    else if (last?.ok) st = 'done';
    if (current && (state?.status === 'failed' || state?.status === 'stopped')) st = 'failed';
    const sub =
      stage === 'repair' && runs.length
        ? `${runs.length} attempt${runs.length === 1 ? '' : 's'}${last?.summary ? ` · ${last.summary}` : ''}`
        : last?.summary || undefined;
    return { id: stage, label, icon: STAGE_ICON[stage]({ size: 13 }), ...(sub ? { sub } : {}), state: st };
  });
}

export const elapsed = (state: PipelineState | null, now: number) => {
  if (!state?.startedAt) return '0:00';
  const s = Math.max(0, ((state.endedAt ?? now) - state.startedAt) / 1000);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
