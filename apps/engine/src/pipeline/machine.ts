import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  idlePipeline,
  Plan,
  PipelineState,
  RpcError,
  type AgentEvent,
  type PlanEdit,
  type Gate,
  type PipelineStage,
  type Project,
} from '@studio/core';
import type { AgentManager } from '../agent/session';
import type { ProjectStore } from '../projects';
import type { ProjectRunResult } from '../recording';
import { knowledgeLine, type WorkspaceGit } from '../workspaceGit';
import {
  nudge,
  planInstruction,
  postInstruction,
  repairInstruction,
  retroInstruction,
  reviseInstruction,
  scriptInstruction,
} from './instructions';

export interface PipelineDeps {
  store: ProjectStore;
  agents: AgentManager;
  runProject(slug: string, mode: 'dry' | 'record'): Promise<ProjectRunResult>;
  stopRun(): void;
  onTake(slug: string): void;
  emit(state: PipelineState): void;
  /**
   * Voices the narration after post-production; returns a line for the stage summary, or null
   * when there is no voice or key yet (optional in tests).
   */
  voiceover?(slug: string, group: string): Promise<string | null>;
  /** Knowledge commits after repairs (optional in tests). */
  git?: WorkspaceGit;
  onCommit?(): void;
}

type Decision = { kind: 'approve' } | { kind: 'revise'; feedback: string };

class Stopped extends Error {}

interface StageResult {
  ok: boolean;
  summary: string;
  /** One line describing skill changes, used as the knowledge commit message. */
  knowledge?: string;
}

interface Live {
  abort: AbortController;
  /** Resolves the waiting gate. */
  decide?: (d: Decision) => void;
  /** Resolves the agent stage the machine is waiting on. */
  stageDone?: { stage: PipelineStage; resolve: (r: StageResult) => void };
}

const STAGE_STATUS: Partial<Record<PipelineStage, Project['status']>> = {
  storyboard_gate: 'storyboard',
  record: 'recording',
};

/**
 * Runs each project's production pipeline: plan → storyboard gate → script → dry run
 * (→ repair, capped) → record → post → retro. Agent stages send an instruction into the
 * project's session and wait for `stage_done`; the engine runs dry runs and recordings itself,
 * so their result never depends on the agent's word. State is saved in `.studio/pipeline.json`.
 */
export class PipelineManager {
  private states = new Map<string, PipelineState>();
  private live = new Map<string, Live>();
  /** Product version seen in each project's latest run, for knowledge commit messages. */
  private versions = new Map<string, string>();

  constructor(private deps: PipelineDeps) {}

  private file(slug: string) {
    return path.join(this.deps.store.dir(slug), '.studio', 'pipeline.json');
  }

  async get(slug: string): Promise<PipelineState> {
    const cached = this.states.get(slug);
    if (cached) return cached;
    let state = idlePipeline(slug);
    try {
      const parsed = PipelineState.safeParse(JSON.parse(await readFile(this.file(slug), 'utf8')));
      if (parsed.success) state = parsed.data;
    } catch {
      // No pipeline yet.
    }
    // A stage that was running when the engine stopped can't continue; a gate can.
    if (state.status === 'running')
      state = { ...state, status: 'stopped', error: 'The app was closed while this stage was running.' };
    this.states.set(slug, state);
    return state;
  }

  private async set(slug: string, patch: Partial<PipelineState>): Promise<PipelineState> {
    const state = PipelineState.parse({ ...(await this.get(slug)), ...patch });
    this.states.set(slug, state);
    const file = this.file(slug);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2) + '\n');
    await rename(`${file}.tmp`, file);
    this.deps.emit(state);
    return state;
  }

  async start(slug: string, gates: Partial<PipelineState['gates']> = {}): Promise<PipelineState> {
    await this.deps.store.open(slug);
    const cur = await this.get(slug);
    if (this.live.has(slug)) throw new RpcError('the pipeline is already running', 'bad_request');
    const { status: agent } = await this.deps.agents.get(slug).status();
    const state = await this.set(slug, {
      ...idlePipeline(slug),
      status: 'running',
      runId: `run-${Date.now().toString(36)}`,
      startedAt: Date.now(),
      gates: { ...cur.gates, ...gates },
      costAtStart: agent.costUsd,
    });
    this.launch(slug, 'plan');
    return state;
  }

  async approve(slug: string): Promise<PipelineState> {
    return this.decide(slug, { kind: 'approve' });
  }

  async revise(slug: string, feedback: string): Promise<PipelineState> {
    return this.decide(slug, { kind: 'revise', feedback });
  }

  private async decide(slug: string, d: Decision): Promise<PipelineState> {
    const state = await this.get(slug);
    if (state.status !== 'waiting' || !state.gate)
      throw new RpcError('nothing is waiting for review', 'bad_request');
    const live = this.live.get(slug);
    if (live?.decide) {
      live.decide(d);
      return this.get(slug);
    }
    // A gate restored after a restart: continue from it.
    this.launch(slug, state.gate.stage, d);
    return this.get(slug);
  }

  async stop(slug: string): Promise<PipelineState> {
    const live = this.live.get(slug);
    if (!live) {
      const state = await this.get(slug);
      return state.status === 'waiting'
        ? this.set(slug, { status: 'stopped', gate: null, endedAt: Date.now() })
        : state;
    }
    live.abort.abort();
    this.deps.stopRun();
    await this.deps.agents.get(slug).interrupt();
    return this.get(slug);
  }

  /** `save_plan` from the agent. */
  async savePlan(slug: string, plan: unknown): Promise<Plan> {
    const parsed = Plan.parse(plan);
    await this.set(slug, { plan: parsed });
    return parsed;
  }

  /** Storyboard edits from the user, while the plan is waiting for review. */
  async editPlan(slug: string, edits: PlanEdit[]): Promise<PipelineState> {
    const state = await this.get(slug);
    if (!state.plan || state.status !== 'waiting' || state.gate?.kind !== 'storyboard')
      throw new RpcError('the plan can only be edited during the storyboard review', 'bad_request');
    const plan = structuredClone(state.plan);
    for (const e of edits) {
      if (e.op === 'step') {
        const step = plan.steps.find((s) => s.id === e.id);
        if (!step) throw new RpcError(`no step "${e.id}" in the plan`, 'not_found');
        step[e.field] = e.value;
      } else {
        const ex = plan.explainers[e.index];
        if (!ex) throw new RpcError(`no explainer ${e.index} in the plan`, 'not_found');
        ex.idea = e.idea;
      }
    }
    return this.set(slug, { plan: Plan.parse(plan) });
  }

  /** `stage_done` from the agent: returns the text the tool replies with. */
  stageDone(slug: string, stage: PipelineStage, ok: boolean, summary: string, knowledge?: string): string {
    const waiting = this.live.get(slug)?.stageDone;
    if (!waiting) return 'No pipeline stage is waiting for you right now; nothing to do.';
    if (waiting.stage !== stage)
      return `The pipeline is waiting for the "${waiting.stage}" stage, not "${stage}".`;
    waiting.resolve({ ok, summary, ...(knowledge ? { knowledge } : {}) });
    return ok
      ? `Stage "${stage}" recorded. Finish your turn now; the pipeline continues with the next stage.`
      : `Stage "${stage}" marked as blocked; the user will be asked for help. Finish your turn now.`;
  }

  private launch(slug: string, from: PipelineStage, decision?: Decision) {
    const live: Live = { abort: new AbortController() };
    this.live.set(slug, live);
    void this.run(slug, live, from, decision)
      .catch(async (e: unknown) => {
        if (e instanceof Stopped || live.abort.signal.aborted)
          await this.set(slug, { status: 'stopped', gate: null, endedAt: Date.now() });
        else
          await this.set(slug, {
            status: 'failed',
            gate: null,
            endedAt: Date.now(),
            error: e instanceof Error ? e.message : String(e),
          });
      })
      .finally(() => {
        if (this.live.get(slug) === live) this.live.delete(slug);
      });
  }

  private async begin(slug: string, stage: PipelineStage) {
    const state = await this.get(slug);
    const status = STAGE_STATUS[stage];
    if (status) await this.deps.store.setStatus(slug, status).catch(() => {});
    await this.set(slug, {
      status: 'running',
      stage,
      gate: null,
      error: null,
      history: [...state.history, { stage, startedAt: Date.now(), endedAt: null, ok: null, summary: '' }],
    });
  }

  private async end(slug: string, ok: boolean, summary: string) {
    const state = await this.get(slug);
    const history = [...state.history];
    const last = history.at(-1);
    if (last && last.endedAt === null)
      history[history.length - 1] = { ...last, endedAt: Date.now(), ok, summary };
    await this.set(slug, { history });
  }

  /** Appends to the summary of the last finished stage. */
  private async annotate(slug: string, extra: string) {
    const state = await this.get(slug);
    const history = [...state.history];
    const last = history.at(-1);
    if (!last) return;
    history[history.length - 1] = { ...last, summary: last.summary ? `${last.summary} · ${extra}` : extra };
    await this.set(slug, { history });
  }

  /** Commits what the agent learned during a stage; reports the knowledge commits it made. */
  private async commitKnowledge(slug: string, summary: string, before: string | null) {
    const version = this.versions.get(slug) ?? null;
    const git = this.deps.git;
    if (!git) return;
    try {
      const own = await git.skillCommitsSince(before);
      const leftover = await git.commitSkills(summary, version);
      const commits = [...(leftover ? [leftover] : []), ...own];
      if (commits.length) {
        this.deps.onCommit?.();
        await this.annotate(slug, commits.map((c) => `${c.hash} ${c.subject}`).join('; '));
      }
    } catch (e) {
      await this.annotate(
        slug,
        `could not commit skill changes: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Waits for the user at a gate. */
  private async gate(slug: string, live: Live, gate: Gate): Promise<Decision> {
    if (live.abort.signal.aborted) throw new Stopped();
    await this.set(slug, { status: 'waiting', stage: gate.stage, gate });
    const d = await new Promise<Decision>((resolve, reject) => {
      live.decide = resolve;
      live.abort.signal.addEventListener('abort', () => reject(new Stopped()), { once: true });
    });
    live.decide = undefined;
    await this.set(slug, { status: 'running', gate: null });
    return d;
  }

  /**
   * Sends an instruction and waits until the agent calls stage_done and its turn ends. A turn
   * that ends without stage_done gets one nudge; a second one counts as blocked.
   */
  private async agentStage(
    slug: string,
    live: Live,
    stage: PipelineStage,
    instruction: string,
  ): Promise<StageResult> {
    if (live.abort.signal.aborted) throw new Stopped();
    const session = this.deps.agents.get(slug);
    return new Promise((resolve, reject) => {
      let result: StageResult | null = null;
      let nudged = false;
      const finish = (fn: () => void) => {
        off();
        live.stageDone = undefined;
        fn();
      };
      live.stageDone = { stage, resolve: (r) => (result = r) };
      const off = session.subscribe((e: AgentEvent) => {
        const turnEnded =
          e.kind === 'result' || (e.kind === 'error' && e.text.startsWith('The agent session stopped'));
        if (!turnEnded) return;
        if (live.abort.signal.aborted) return finish(() => reject(new Stopped()));
        if (result) return finish(() => resolve(result!));
        if (!nudged) {
          nudged = true;
          void session.send(nudge(stage), 'pipeline');
          return;
        }
        finish(() =>
          resolve({ ok: false, summary: `The agent ended its turn twice without finishing "${stage}".` }),
        );
      });
      live.abort.signal.addEventListener('abort', () => finish(() => reject(new Stopped())), { once: true });
      void session.send(instruction, 'pipeline').catch((e: unknown) => finish(() => reject(e)));
    });
  }

  /** An agent stage that may block: asks the user for help until it succeeds. */
  private async agentStageWithHelp(
    slug: string,
    live: Live,
    stage: PipelineStage,
    instruction: string,
    opts: { commit?: boolean } = {},
  ) {
    let text = instruction;
    for (;;) {
      await this.begin(slug, stage);
      const before = (await this.deps.git?.head()) ?? null;
      const r = await this.agentStage(slug, live, stage, text);
      await this.end(slug, r.ok, r.summary);
      if (opts.commit !== false) await this.commitKnowledge(slug, r.knowledge ?? r.summary, before);
      if (r.ok) return r;
      const d = await this.gate(slug, live, {
        stage,
        kind: 'help',
        title: `The agent needs help with "${stage}"`,
        text: r.summary,
      });
      text = d.kind === 'revise' ? `${instruction}\n\nThe user adds:\n\n${d.feedback}` : instruction;
    }
  }

  /**
   * The retrospective: the agent records lessons and product facts, then the user reviews the
   * knowledge diff. Approve commits it as one `lessons:` commit; revise asks the agent again.
   */
  private async retro(slug: string, live: Live) {
    const git = this.deps.git;
    let feedback: string | undefined;
    for (;;) {
      const history = (await this.get(slug)).history
        .filter((h) => h.stage !== 'retro' && h.stage !== 'storyboard_gate')
        .map((h) => ({ stage: h.stage, ok: h.ok, summary: h.summary }));
      const claudeMd = path.join(this.deps.store.workspace, 'CLAUDE.md');
      const claudeMdBytes = (await stat(claudeMd).catch(() => null))?.size ?? 0;
      const r = await this.agentStageWithHelp(
        slug,
        live,
        'retro',
        retroInstruction({ history, claudeMdBytes, ...(feedback ? { feedback } : {}) }),
        { commit: false },
      );
      const diff = (await git?.knowledgeDiff()) ?? '';
      if (!diff.trim()) {
        await this.annotate(slug, 'nothing new to record');
        return;
      }
      const d = await this.gate(slug, live, {
        stage: 'retro',
        kind: 'knowledge',
        title: 'Review what the agent learned',
        text: r.summary,
        diff,
      });
      if (d.kind === 'approve') {
        const version = this.versions.get(slug);
        const message = `lessons: ${knowledgeLine(r.knowledge ?? r.summary) || 'retrospective'}${version ? ` [${version}]` : ''}`;
        const c = await git!.commitKnowledge(message);
        if (c) {
          this.deps.onCommit?.();
          await this.annotate(slug, `${c.hash} ${c.subject}`);
        }
        return;
      }
      if (/^\s*(discard|reject|drop)\b/i.test(d.feedback)) {
        await git!.discardKnowledge();
        await this.annotate(slug, 'discarded by the user');
        return;
      }
      feedback = d.feedback;
    }
  }

  private async engineRun(
    slug: string,
    mode: 'dry' | 'record',
  ): Promise<ProjectRunResult | { error: string }> {
    try {
      const r = await this.deps.runProject(slug, mode);
      if (r.take) this.deps.onTake(slug);
      return r;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async run(slug: string, live: Live, from: PipelineStage, decision?: Decision): Promise<void> {
    let stage: PipelineStage | 'done' = from;
    let pending = decision;
    let failure: {
      mode: 'dry' | 'record';
      stepId: string | null;
      error: string;
      errorDetail?: string;
    } | null = null;
    let helpFeedback: string | undefined;
    while (stage !== 'done') {
      if (live.abort.signal.aborted) throw new Stopped();
      switch (stage) {
        case 'plan': {
          const brief = await this.deps.store.readBrief(slug).catch(() => null);
          await this.agentStageWithHelp(
            slug,
            live,
            'plan',
            planInstruction({ explainers: brief?.explainers ?? true }),
          );
          if (!(await this.get(slug)).plan)
            await this.agentStageWithHelp(
              slug,
              live,
              'plan',
              'You finished planning without saving a plan. Save it with save_plan, then call stage_done.',
            );
          stage = 'storyboard_gate';
          break;
        }
        case 'storyboard_gate': {
          const state = await this.get(slug);
          if (!state.gates.storyboard && !pending) {
            stage = 'script';
            break;
          }
          let revised = false;
          for (;;) {
            await this.begin(slug, 'storyboard_gate');
            const plan = (await this.get(slug)).plan;
            const d =
              pending ??
              (await this.gate(slug, live, {
                stage: 'storyboard_gate',
                kind: 'storyboard',
                title: revised ? 'Review the revised storyboard' : 'Review the storyboard',
                text: `${plan?.steps.length ?? 0} steps planned. Approve to write and record the script, or ask the agent for changes.`,
              }));
            pending = undefined;
            if (d.kind === 'approve') {
              await this.end(slug, true, 'Approved');
              break;
            }
            await this.end(slug, true, `Changes requested: ${d.feedback}`);
            await this.agentStageWithHelp(slug, live, 'plan', reviseInstruction(d.feedback));
            revised = true;
          }
          stage = 'script';
          break;
        }
        case 'script': {
          const plan = (await this.get(slug)).plan;
          if (!plan) throw new Error('there is no plan to script');
          await this.agentStageWithHelp(slug, live, 'script', scriptInstruction(plan));
          stage = 'dry_run';
          break;
        }
        case 'dry_run':
        case 'record': {
          const mode: 'dry' | 'record' = stage === 'dry_run' ? 'dry' : 'record';
          await this.begin(slug, stage);
          const r = await this.engineRun(slug, mode);
          if (live.abort.signal.aborted) throw new Stopped();
          if (!('error' in r)) {
            const start = r.events.find((e) => e.kind === 'marker' && e.name === 'start');
            const v = start?.kind === 'marker' ? start.data?.version : undefined;
            if (typeof v === 'string') this.versions.set(slug, v);
          }
          if ('error' in r) failure = { mode, stepId: null, error: r.error };
          else if (!r.passed)
            failure = {
              mode,
              stepId: r.failure?.stepId ?? null,
              error: r.failure?.error ?? 'failed',
              ...(r.failure?.errorDetail ? { errorDetail: r.failure.errorDetail } : {}),
            };
          else {
            failure = null;
            const steps = r.events.filter((e) => e.kind === 'step-end').length;
            await this.end(
              slug,
              true,
              mode === 'dry'
                ? `${steps} steps passed`
                : `Recorded ${r.take?.id ?? 'a take'}${r.take ? ` (${r.take.duration.toFixed(1)} s)` : ''}`,
            );
            if (mode === 'dry') await this.set(slug, { repairAttempts: 0 });
            stage = mode === 'dry' ? 'record' : 'post';
            break;
          }
          await this.end(slug, false, `${failure.stepId ? `${failure.stepId}: ` : ''}${failure.error}`);
          stage = 'repair';
          break;
        }
        case 'repair': {
          const state = await this.get(slug);
          if (state.repairAttempts >= state.maxRepairs) {
            const d = await this.gate(slug, live, {
              stage: 'repair',
              kind: 'help',
              title: `Agent needs help${failure?.stepId ? ` at step ${failure.stepId}` : ''}`,
              text: `${state.maxRepairs} repair attempts didn't fix it: ${failure?.error ?? 'unknown error'}. Approve to let the agent try again, or tell it what to do.`,
            });
            await this.set(slug, { repairAttempts: 0 });
            helpFeedback = d.kind === 'revise' ? d.feedback : undefined;
          }
          const attempt = (await this.get(slug)).repairAttempts + 1;
          await this.set(slug, { repairAttempts: attempt });
          await this.agentStageWithHelp(
            slug,
            live,
            'repair',
            repairInstruction({
              attempt,
              max: state.maxRepairs,
              mode: failure?.mode ?? 'dry',
              stepId: failure?.stepId ?? null,
              error: failure?.error ?? 'unknown error',
              ...(failure?.errorDetail ? { errorDetail: failure.errorDetail } : {}),
              ...(helpFeedback ? { feedback: helpFeedback } : {}),
            }),
          );
          helpFeedback = undefined;
          stage = 'dry_run';
          break;
        }
        case 'post': {
          await this.agentStageWithHelp(slug, live, 'post', postInstruction((await this.get(slug)).plan));
          if (this.deps.voiceover) {
            const note = await this.deps
              .voiceover(slug, (await this.get(slug)).runId ?? 'pipeline')
              .catch((e: unknown) => `Voice-over failed: ${e instanceof Error ? e.message : String(e)}`);
            if (note) await this.annotate(slug, note);
          }
          stage = 'retro';
          break;
        }
        case 'retro': {
          await this.retro(slug, live);
          stage = 'done';
          break;
        }
      }
    }
    await this.deps.store.setStatus(slug, 'edit').catch(() => {});
    await this.set(slug, { status: 'done', stage: null, gate: null, endedAt: Date.now() });
  }
}
