import type { AgentEvent, PipelineProgress, PipelineStage, PipelineState, StageRecord } from '@studio/core';
import { stageActivity } from './stages';

/** One line of "What it did": plain words, with the technical side behind a click. */
export interface FeedRow {
  key: string;
  tone: 'ok' | 'warn' | 'fail' | 'you';
  text: string;
  /** How long it took, e.g. "2m 10s". */
  took?: string;
  at: number;
  details: FeedDetail[];
  /** Tool calls made during it (name and summary). */
  tools?: { name: string; summary: string }[];
}

export interface FeedDetail {
  label: string;
  value: string;
}

const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A finished stage in plain words. */
export function stageDoneText(r: StageRecord, st: PipelineState): string {
  const interrupted =
    /^(interrupted|stopped by user)/i.test(r.summary) || /: stopped by user$/i.test(r.summary);
  if (r.ok === false && interrupted) return `Stopped while ${lower(stageActivity(r.stage, st))}`;
  const steps = st.plan?.steps.length ?? 0;
  switch (r.stage) {
    case 'plan':
      return r.ok
        ? steps
          ? `Planned ${plural(steps, 'step')}`
          : 'Planned the steps'
        : 'Couldn’t finish the plan';
    case 'from_capture':
      return r.ok
        ? steps
          ? `Turned your demo into ${plural(steps, 'step')}`
          : 'Turned your demo into steps'
        : 'Couldn’t turn your demo into steps';
    case 'storyboard_gate':
      return 'You approved the steps';
    case 'script':
      return r.ok ? 'Got the steps ready to test' : 'Couldn’t get the steps ready to test';
    case 'dry_run': {
      const failed = /^(s\d+|setup):/i.exec(r.summary)?.[1];
      if (r.ok)
        return /cues checked/.test(r.summary)
          ? 'Every step works, in time with the voice'
          : 'Every step works';
      return failed
        ? failed === 'setup'
          ? 'The setup before step 1 didn’t work'
          : `Step ${failed.slice(1)} didn’t work`
        : 'A step didn’t work';
    }
    case 'repair':
      return r.ok ? 'Fixed what went wrong' : 'Tried to fix it, without luck';
    case 'narrate':
      return r.ok ? 'Wrote the script' : 'Couldn’t finish the script';
    case 'voice':
      return r.ok ? 'Made the voice-over' : 'Couldn’t make the voice-over';
    case 'align':
      return r.ok ? 'Timed the clicks to the voice-over' : 'Couldn’t time the clicks to the voice-over';
    case 'record':
      return r.ok ? 'Recorded the video' : 'The recording didn’t finish';
    case 'post':
      return r.ok ? 'Edited the video' : 'Couldn’t finish an edit';
    case 'qa':
      return r.ok ? 'Watched the whole video for problems' : 'Couldn’t finish the final check';
    case 'retro':
      return r.ok ? 'Noted what it learned' : 'Couldn’t note what it learned';
  }
}

const lower = (s: string) => s.replace(/^./, (c) => c.toLowerCase());
const shortTool = (name: string) => name.replace(/^mcp__studio__/, '').replace(/^mcp__([^_]+)__/, '$1 · ');

/**
 * "What it did" for one run: each finished stage (with the tool calls, cost and session behind
 * it), your answers to permission requests, and what you asked it to change.
 */
export function buildFeed(st: PipelineState | null, events: AgentEvent[]): FeedRow[] {
  const from = st?.history[0]?.startedAt ?? st?.startedAt;
  if (!st || !from) return [];
  const runEvents = events.filter((e) => e.at >= from);
  const costAt = (t: number) => {
    const r = runEvents
      .filter((e): e is Extract<AgentEvent, { kind: 'result' }> => e.kind === 'result' && e.at <= t)
      .at(-1);
    return r ? Math.max(0, r.costUsd - st.costAtStart) : null;
  };
  const sessionAt = (t: number) =>
    events.filter((e): e is Extract<AgentEvent, { kind: 'init' }> => e.kind === 'init' && e.at <= t).at(-1)
      ?.sessionId ?? null;

  const rows: FeedRow[] = [];
  st.history.forEach((r, i) => {
    if (r.endedAt === null) return;
    const tools = runEvents
      .filter(
        (e): e is Extract<AgentEvent, { kind: 'tool_use' }> =>
          e.kind === 'tool_use' && e.at >= r.startedAt && e.at <= r.endedAt!,
      )
      .map((e) => ({ name: shortTool(e.name), summary: e.summary }));
    const cost = costAt(r.endedAt);
    const session = sessionAt(r.endedAt);
    const interrupted = r.ok === false && /^(interrupted|stopped by user)/i.test(r.summary);
    rows.push({
      key: `h${i}`,
      tone: r.stage === 'storyboard_gate' ? 'you' : r.ok ? 'ok' : interrupted ? 'warn' : 'fail',
      text: stageDoneText(r, st),
      took: r.stage === 'storyboard_gate' ? undefined : dur(r.endedAt - r.startedAt),
      at: r.endedAt,
      details: [
        { label: 'Stage', value: r.stage },
        ...(r.summary ? [{ label: 'Agent says', value: r.summary }] : []),
        ...(cost !== null ? [{ label: 'Cost so far', value: `$${cost.toFixed(2)}` }] : []),
        ...(session ? [{ label: 'Session', value: session.slice(0, 8) }] : []),
      ],
      tools,
    });
  });

  // Permission answers and what you asked for.
  const asked = new Map<string, Extract<AgentEvent, { kind: 'permission' }>>();
  for (const e of runEvents) {
    if (e.kind === 'permission') asked.set(e.requestId, e);
    if (e.kind === 'permission_resolved') {
      const p = asked.get(e.requestId);
      rows.push({
        key: `p${e.seq}`,
        tone: 'you',
        text: `You ${e.allowed ? 'allowed' : 'denied'} ${p ? describeTool(p.tool, p.summary) : 'a request'}`,
        at: e.at,
        details: p
          ? [
              { label: 'Tool', value: shortTool(p.tool) },
              { label: 'Input', value: p.summary },
              ...(p.reason ? [{ label: 'Why it asked', value: p.reason }] : []),
            ]
          : [],
      });
    }
    if (e.kind === 'user' && e.source === 'user')
      rows.push({
        key: `u${e.seq}`,
        tone: 'you',
        text: `You asked: “${clip(e.text, 90)}”`,
        at: e.at,
        details: [{ label: 'Message', value: e.text }],
      });
  }
  return rows.sort((a, b) => a.at - b.at);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A permission request as a short phrase: "running npm install", "editing script.spec.ts". */
export function describeTool(tool: string, summary: string): string {
  const s = clip(summary, 60);
  if (tool === 'Bash') return `running ${s}`;
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return `editing ${s}`;
  if (tool === 'WebFetch') return `reading ${s}`;
  return `${shortTool(tool)} (${s})`;
}

/** The running row: what is happening now, with the stage's items and latest tool calls. */
export interface RunningRow {
  text: string;
  since: number | null;
  items: PipelineProgress['items'];
  tools: { name: string; summary: string }[];
  /** The agent's latest words, if any. */
  said: string | null;
  stage: PipelineStage;
}

export function runningRow(
  st: PipelineState | null,
  events: AgentEvent[],
  progress: PipelineProgress | null,
  since: number | null,
): RunningRow | null {
  if (!st || st.status !== 'running' || !st.stage) return null;
  const recent = since ? events.filter((e) => e.at >= since) : [];
  return {
    text: progress?.message ?? stageActivity(st.stage, st),
    since,
    items: progress?.items ?? [],
    tools: recent
      .filter((e): e is Extract<AgentEvent, { kind: 'tool_use' }> => e.kind === 'tool_use')
      .slice(-6)
      .map((e) => ({ name: shortTool(e.name), summary: e.summary })),
    said:
      recent.filter((e): e is Extract<AgentEvent, { kind: 'text' }> => e.kind === 'text').at(-1)?.text ??
      null,
    stage: st.stage,
  };
}
