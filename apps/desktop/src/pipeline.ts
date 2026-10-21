import { useCallback, useEffect, useState } from 'react';
import { PIPELINE_STAGES, type PipelineState } from '@studio/core';
import type { StepState } from '@studio/ui';
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
    start: (gates?: { storyboard?: boolean }) =>
      act(() => client!.call('pipeline.start', { slug: target!, ...(gates ? { gates } : {}) })),
    approve: () => act(() => client!.call('pipeline.approve', { slug: target! })),
    revise: (feedback: string) => act(() => client!.call('pipeline.revise', { slug: target!, feedback })),
    stop: () => act(() => client!.call('pipeline.stop', { slug: target! })),
  };
}

/** Whether a stage has run in this pipeline. */
const ran = (history: PipelineState['history'], stage: string) => history.some((h) => h.stage === stage);

/**
 * Stepper rows for the pipeline. Repair shows once it has run; narrate and voice (voice-first
 * pacing) are hidden in a finished run that skipped them.
 */
export function pipelineSteps(
  state: PipelineState | null,
): { label: string; sub?: string; state: StepState }[] {
  const history = state?.history ?? [];
  return PIPELINE_STAGES.filter((s) =>
    s.stage === 'repair'
      ? ran(history, 'repair')
      : s.stage === 'narrate' || s.stage === 'voice'
        ? ran(history, s.stage) || state?.status !== 'done'
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
    return { label, ...(sub ? { sub } : {}), state: st };
  });
}

export const elapsed = (state: PipelineState | null, now: number) => {
  if (!state?.startedAt) return '0:00';
  const s = Math.max(0, ((state.endedAt ?? now) - state.startedAt) / 1000);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
