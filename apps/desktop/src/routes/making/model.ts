import { useEffect, useMemo, useState } from 'react';
import {
  BRIEF_LENGTHS,
  type AgentEvent,
  type AgentStatus,
  type PipelineProgress,
  type PipelineState,
  type PlanEdit,
} from '@studio/core';
import { useEngine } from '../../engine';
import { usePipeline } from '../../pipeline';
import { useAgent } from '../../studio/useAgent';
import { useLiveView, type LiveView } from './useLiveView';

export type PermissionEvent = Extract<AgentEvent, { kind: 'permission' }>;
export type Length = (typeof BRIEF_LENGTHS)[number];

/** Everything the Making screen shows, from the engine or from a dev preview. */
export interface MakingModel {
  slug: string;
  title: string;
  state: PipelineState | null;
  /** The running stage's item-by-item progress, when it belongs to this run's stage. */
  progress: PipelineProgress | null;
  events: AgentEvent[];
  agent: AgentStatus | null;
  /** Tool calls waiting for Allow or Deny. */
  pending: PermissionEvent[];
  live: LiveView;
  /** The finished video's length (s), once there is a take. */
  duration: number | null;
  /** The finished video's poster (a full URL). */
  poster: string | null;
  /** The brief's target length. */
  target: Length;
  /** Whether the brief already lets the agent approve safe calls by itself. */
  autoMode: boolean;
  /** A project-relative file as a URL on the engine. */
  media: (rel: string, version?: number) => string | null;
  ready: boolean;
  error: string | null;
  /** True in a dev preview: actions only say what they would do. */
  preview?: boolean;
}

export interface MakingActions {
  approve: (opts?: { choice?: string; remember?: boolean }) => Promise<void>;
  revise: (feedback: string) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => Promise<void>;
  /** Steers the running agent; says whether it reads it now or at its next step. */
  steer: (text: string) => Promise<'now' | 'next'>;
  answer: (requestId: string, allow: boolean) => Promise<void>;
  /** Lets the agent approve safe calls by itself for this tutorial (the brief's auto mode). */
  allowSafe: () => Promise<void>;
  editPlan: (edits: PlanEdit[]) => Promise<void>;
}

/** The Making screen's data and actions for one tutorial, from the engine. */
export function useMakingModel(slug: string): { model: MakingModel; actions: MakingActions } {
  const { client, state: conn, info } = useEngine();
  const pipe = usePipeline(slug);
  const agent = useAgent(slug);
  const live = useLiveView(slug);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [meta, setMeta] = useState<{ title: string; duration: number | null; poster: string | null } | null>(
    null,
  );
  const [brief, setBrief] = useState<{ length: string; autoMode: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = pipe.state?.status;
  useEffect(() => {
    if (!client || conn !== 'open') return;
    void client.call('project.list', {}).then(
      (list) => {
        const p = list.find((x) => x.slug === slug);
        if (p) setMeta({ title: p.title, duration: p.duration, poster: p.poster });
      },
      () => undefined,
    );
    void client.call('brief.get', { slug }).then(
      (b) => setBrief({ length: b.length, autoMode: !!b.autoMode }),
      () => undefined,
    );
    // Reloaded when the run ends, for the finished video's length and poster.
  }, [client, conn, slug, status]);

  useEffect(() => {
    if (!client) return;
    return client.on('pipeline.progress', (p) => p.slug === slug && setProgress(p));
  }, [client, slug]);

  const st = pipe.state;
  const stage = st?.status === 'running' || st?.status === 'waiting' ? st.stage : null;
  const shownProgress =
    progress && (progress.stage === stage || (progress.stage === 'voice' && stage === 'align'))
      ? progress
      : null;

  const pendingIds = agent.status?.pending;
  const pending = useMemo(() => {
    const ids = new Set(pendingIds ?? []);
    return agent.events.filter((e): e is PermissionEvent => e.kind === 'permission' && ids.has(e.requestId));
  }, [agent.events, pendingIds]);

  const media = (rel: string, version?: number) =>
    info
      ? `http://127.0.0.1:${info.port}/media/${slug}/${rel}?token=${encodeURIComponent(info.token)}${version ? `&v=${version}` : ''}`
      : null;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const model: MakingModel = {
    slug,
    title: meta?.title ?? slug,
    state: st,
    progress: shownProgress,
    events: agent.events,
    agent: agent.status,
    pending,
    live,
    duration: meta?.duration ?? null,
    poster:
      meta?.poster && info
        ? `http://127.0.0.1:${info.port}${meta.poster}?token=${encodeURIComponent(info.token)}`
        : null,
    target: BRIEF_LENGTHS.find((l) => l.value === (brief?.length ?? 'medium')) ?? BRIEF_LENGTHS[1],
    autoMode: brief?.autoMode ?? false,
    media,
    ready: pipe.ready,
    error: error ?? pipe.error ?? agent.error,
  };

  const actions: MakingActions = {
    approve: (opts) => pipe.approve(opts),
    revise: (feedback) => pipe.revise(feedback),
    stop: () => pipe.stop(),
    resume: () => pipe.resume(),
    steer: (text) => pipe.steer(text),
    answer: (id, allow) => agent.answer(id, allow),
    allowSafe: () =>
      run(async () => {
        const b = await client!.call('brief.get', { slug });
        await client!.call('brief.save', { slug, brief: { ...b, autoMode: true } });
        setBrief((x) => (x ? { ...x, autoMode: true } : x));
      }),
    editPlan: (edits) => run(() => client!.call('pipeline.editPlan', { slug, edits })),
  };
  return { model, actions };
}
