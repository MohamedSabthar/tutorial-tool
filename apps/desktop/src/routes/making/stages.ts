import type { AgentStatus, PipelineStage, PipelineState } from '@studio/core';

/**
 * The Making screen's five stages (six with "Check the steps"), and how the engine's thirteen
 * pipeline stages fall into them.
 */
export type GroupId = 'plan' | 'steps' | 'test' | 'script' | 'record' | 'finish';

export interface Group {
  id: GroupId;
  name: string;
  stages: PipelineStage[];
  /** A step that waits for the user. */
  you?: boolean;
}

export const GROUPS: Group[] = [
  { id: 'plan', name: 'Planning', stages: ['plan', 'from_capture'] },
  { id: 'steps', name: 'Check the steps', stages: ['storyboard_gate'], you: true },
  { id: 'test', name: 'Testing the steps', stages: ['script', 'dry_run', 'repair'] },
  { id: 'script', name: 'Check the script', stages: ['narrate'], you: true },
  { id: 'record', name: 'Recording', stages: ['voice', 'align', 'record'] },
  { id: 'finish', name: 'Finishing', stages: ['post', 'qa', 'retro'] },
];

export const groupOf = (stage: PipelineStage): GroupId => GROUPS.find((g) => g.stages.includes(stage))!.id;

/**
 * Typical minutes per stage, for a rough "about N min left". Repair only counts once it is
 * running; gates count as nothing (they wait for the user).
 */
export const TYPICAL_MIN: Record<PipelineStage, number> = {
  plan: 4,
  from_capture: 3,
  storyboard_gate: 0,
  script: 3,
  dry_run: 4,
  repair: 4,
  narrate: 3,
  voice: 1,
  align: 2,
  record: 6,
  post: 4,
  qa: 2,
  retro: 1,
};

/** The groups this run shows: "Check the steps" only when the run has that gate on (or used it). */
export function runGroups(st: PipelineState | null): Group[] {
  const steps = !!st && (st.gates.storyboard || st.history.some((h) => h.stage === 'storyboard_gate'));
  return GROUPS.filter((g) => g.id !== 'steps' || steps);
}

export type GroupState = 'done' | 'now' | 'you' | 'failed' | 'wait';

export interface GroupView extends Group {
  state: GroupState;
  /** 0–1: how far the stripe is filled. */
  fill: number;
  /** Short text under the bar: Done, Now, Needs you, ~4 min, You. */
  sub: string;
}

/** When the stage now running started (its open history record), else when the run started. */
export function stageStartedAt(st: PipelineState): number | null {
  const open = [...st.history].reverse().find((h) => h.stage === st.stage && h.endedAt === null);
  return open?.startedAt ?? st.startedAt;
}

const minutes = (g: Group, st: PipelineState | null) =>
  g.stages
    .filter((s) =>
      s === 'from_capture'
        ? st?.entry === 'from_capture'
        : s === 'plan'
          ? st?.entry !== 'from_capture'
          : s !== 'repair',
    )
    .reduce((n, s) => n + TYPICAL_MIN[s], 0);

/** Each group's state for the progress row. `needsYou` is a pending permission request. */
export function groupViews(st: PipelineState | null, now: number, needsYou = false): GroupView[] {
  const groups = runGroups(st);
  if (!st || st.status === 'idle')
    return groups.map((g) => ({
      ...g,
      state: 'wait',
      fill: 0,
      sub: g.you ? 'You' : `~${minutes(g, st)} min`,
    }));
  if (st.status === 'done') return groups.map((g) => ({ ...g, state: 'done', fill: 1, sub: 'Done' }));
  const cur = st.stage ? groups.findIndex((g) => g.stages.includes(st.stage!)) : -1;
  return groups.map((g, i) => {
    if (i < cur) return { ...g, state: 'done', fill: 1, sub: 'Done' };
    if (i > cur) return { ...g, state: 'wait', fill: 0, sub: g.you ? 'You' : `~${minutes(g, st)} min` };
    if (st.status === 'failed' || st.status === 'stopped')
      return {
        ...g,
        state: 'failed',
        fill: 1,
        sub: st.status === 'stopped' ? 'Stopped' : 'Stopped with a problem',
      };
    if (st.status === 'waiting' || needsYou) return { ...g, state: 'you', fill: 1, sub: 'Needs you' };
    return { ...g, state: 'now', fill: groupFill(g, st, now), sub: 'Now' };
  });
}

/** How far into the current group: the stages before this one, plus time in this one (capped). */
function groupFill(g: Group, st: PipelineState, now: number): number {
  const stages = g.stages.filter((s) => s !== 'repair' || st.stage === 'repair');
  const idx = Math.max(0, stages.indexOf(st.stage!));
  const typical = TYPICAL_MIN[st.stage!] * 60_000;
  const since = stageStartedAt(st);
  const part = typical > 0 && since ? Math.min(0.9, (now - since) / typical) : 0.5;
  return Math.max(0.04, Math.min(0.97, (idx + part) / stages.length));
}

/**
 * Rough minutes left: what is left of the stage now running (never under half a minute), plus
 * the typical length of the stages after it. Null when it waits for the user or isn't running.
 */
export function minutesLeft(st: PipelineState | null, now: number): number | null {
  if (!st || st.status !== 'running' || !st.stage) return null;
  const order = runGroups(st).flatMap((g) => g.stages);
  const idx = order.indexOf(st.stage);
  const since = stageStartedAt(st);
  const spent = since ? (now - since) / 60_000 : 0;
  let left = Math.max(0.5, TYPICAL_MIN[st.stage] - spent);
  for (const s of order.slice(idx + 1)) {
    if (s === 'repair') continue;
    if (s === 'plan' || s === 'from_capture') continue;
    // A narration that was already approved isn't asked again; voice-first stages only run with it.
    left += TYPICAL_MIN[s];
  }
  return Math.max(1, Math.round(left));
}

/** What is happening now, in plain words (the status shell's big label). */
export function nowLabel(st: PipelineState | null, opts: { needsPermission?: boolean } = {}): string {
  if (!st || st.status === 'idle') return 'Not started yet';
  if (st.status === 'done') return 'Your tutorial is ready';
  if (st.status === 'failed') return 'It stopped with a problem';
  if (st.status === 'stopped') return 'Stopped';
  if (opts.needsPermission) return 'The agent needs your OK';
  if (st.status === 'waiting' && st.gate) {
    switch (st.gate.kind) {
      case 'narration':
        return 'Your turn: check the script';
      case 'storyboard':
        return 'Your turn: check the steps';
      case 'cues':
        return 'Some clicks land late';
      case 'knowledge':
        return 'Save what it learned?';
      default:
        return 'The agent needs your help';
    }
  }
  return st.stage ? stageActivity(st.stage, st) : 'Starting';
}

/** A stage while it runs, as a plain phrase. */
export function stageActivity(stage: PipelineStage, st?: PipelineState | null): string {
  switch (stage) {
    case 'plan':
      return st?.plan ? 'Revising the steps' : 'Reading and planning the steps';
    case 'from_capture':
      return 'Turning your demo into steps';
    case 'storyboard_gate':
      return 'Waiting for you to check the steps';
    case 'script':
      return 'Getting the steps ready to test';
    case 'dry_run':
      return 'Trying each step in the product';
    case 'repair':
      return 'Fixing a step that didn’t work';
    case 'narrate':
      return 'Writing the script';
    case 'voice':
      return 'Making the voice-over';
    case 'align':
      return 'Timing the clicks to the voice-over';
    case 'record':
      return st?.paced ? 'Recording in time with the voice-over' : 'Recording';
    case 'post':
      return 'Editing the video';
    case 'qa':
      return 'Watching the whole video for problems';
    case 'retro':
      return 'Noting what it learned';
  }
}

/** The detail line under the label for states that wait on the user or ended. */
export function nowDetail(
  st: PipelineState | null,
  opts: { needsPermission?: boolean; progress?: string | null } = {},
): string {
  if (!st || st.status === 'idle') return 'Start it from the brief.';
  if (st.status === 'done') return 'Narrated, edited and ready to watch.';
  if (st.status === 'failed') return 'Everything it did so far is kept.';
  if (st.status === 'stopped') return 'Everything so far is kept. Continue whenever you like.';
  if (opts.needsPermission) return 'It paused before running a command. Nothing happens until you decide.';
  if (st.status === 'waiting' && st.gate) {
    switch (st.gate.kind) {
      case 'narration':
        return 'Read the words before they are voiced. Nothing is recorded until you approve.';
      case 'storyboard':
        return 'Look over the planned steps before it tests them.';
      case 'cues':
        return 'Fix them in the edit, or record again.';
      case 'knowledge':
        return 'It wrote down lessons for next time. Keep them or ask for changes.';
      default:
        return 'It couldn’t carry on by itself. Tell it what to do, or let it try again.';
    }
  }
  return opts.progress ?? '';
}

/** One plain sentence on why the run stopped (the raw error goes under Details). */
export function failureSentence(st: PipelineState): string {
  const err = st.error ?? '';
  const where = st.stage ? stageActivity(st.stage, st).replace(/^./, (c) => c.toLowerCase()) : 'working';
  if (/stopped by (the )?user|interrupted/i.test(err)) return `It was interrupted while ${where}.`;
  if (/cost limit/i.test(err)) return 'It reached the cost limit you set in Settings.';
  if (/sign(ed)? ?in/i.test(err)) return `It couldn’t sign in to the product while ${where}.`;
  return `Something went wrong while ${where}.`;
}

/** This run's agent cost so far (the session's total minus where the run started). */
export const runCost = (st: PipelineState | null, agent: AgentStatus | null): number | null =>
  st && agent && agent.slug === st.slug ? Math.max(0, agent.costUsd - st.costAtStart) : null;

/** Time since a moment, for runs that can wait days: "45s", "12m 05s", "3h 20m", "4 days". */
export function formatSince(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? '' : 's'}`;
}
