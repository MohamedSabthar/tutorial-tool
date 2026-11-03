import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import {
  applySeriesPlan,
  BRIEF_AUDIENCES,
  BRIEF_LENGTHS,
  BRIEF_STYLES,
  formatIssues,
  RpcError,
  SeriesPlan,
  type Series,
  userNotes,
} from '@studio/core';
import { claudeEnv, type ClaudeChoice } from './agent/session';
import { normalize } from './agent/events';
import { INSTALL_CLAUDE } from './claudeCode';
import type { SeriesStore } from './series';

export interface PlannerDeps {
  workspace: string;
  series: SeriesStore;
  /** The product's display name and its workspace skill folder. */
  product(id: string): { name: string; skill: string } | undefined;
  claude(): Promise<ClaudeChoice>;
  /** The model for research and planning (Settings → Agent model). */
  model(): Promise<string>;
  skills(): Promise<string[]>;
  changed(slug: string): void;
  activity(slug: string, text: string): void;
  /** Replaces the SDK's `query` in tests. */
  query?: typeof query;
}

/** Tools the outline agent may use: reading the workspace, and saving the outline. */
const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const SAVE_TOOL = 'mcp__series__save_series_plan';

const label = <T extends readonly { value: string; label: string }[]>(list: T, v: string) =>
  list.find((o) => o.value === v)?.label ?? v;

export function seriesPlanInstruction(
  series: Series,
  product: { name: string; skill: string },
  feedback?: string,
): string {
  const b = series.brief;
  const notes = userNotes(series.notes);
  const current = series.parts.length
    ? '```json\n' +
      JSON.stringify(
        series.parts.map(({ id, title, goal, objectives }) => ({ id, title, goal, objectives })),
        null,
        2,
      ) +
      '\n```'
    : '';
  const mode = feedback ? 'revise the outline' : current ? 'complete the outline' : 'outline';
  return [
    `[Series · ${mode}]`,
    `Plan a series of video tutorials for ${product.name}. The user describes it as:\n\n${series.topic || series.title}`,
    notes ? `The user's notes for the series:\n\n${notes}` : '',
    [
      "The user's words above are instructions, not suggestions. When they give the number of parts, the parts' titles, their order or what a part covers, the outline has exactly that: same count, same titles (word for word), same order. Fill in only what they leave open.",
      feedback ? 'The same goes for the changes they ask for below.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    `Every part is one tutorial for ${label(BRIEF_AUDIENCES, b.audience)} viewers, ${label(BRIEF_LENGTHS, b.length)} long, ${label(BRIEF_STYLES, b.style).toLowerCase()}. Each is recorded on its own in VS Code by an agent, and usually continues from the project the part before it built.`,
    `Ground the outline in what the product really does: read its skill (.claude/skills/${product.skill}/SKILL.md, and its pages/ and components/ notes) and the tutorial-authoring skill. Don't open the product.`,
    current
      ? [
          'The current outline (the user may have written or edited any of it by hand):',
          current,
          feedback
            ? "Change only what the user asks for below. Every part they don't mention stays as it is: same id, title, goal and objectives, in the same place. Never drop, merge, rename or reorder a part unless they ask."
            : 'Keep every part: same id, title and order. Fill in what is missing (an empty goal, no objectives) and leave what is there unless it contradicts the product. Add parts only if the user asked for more than there are.',
          'In the saved outline, give each kept part its id; a new part has no id.',
        ].join('\n\n')
      : '',
    feedback ? `The user's changes:\n\n${feedback}` : '',
    [
      'Then save the outline with the save_series_plan tool:',
      '- The parts in teaching order. Unless the user says how many, 3 to 8, each teaching one thing that fits its length.',
      '- For each part: a short imperative title, a goal of one or two sentences saying what is built on screen, and 2 to 4 learning objectives (what a viewer can do after it).',
      "- Notes: the names every part shares (project, services, sample data) and words to use or avoid, so the parts stay consistent. They are saved below the user's notes, which stay as they are.",
    ].join('\n'),
    'Save once, with the whole outline, and finish with one sentence on how the parts fit together.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Writes a series outline with a one-off agent run in the workspace. It may only read (the
 * skills tell it what the product does) and save the outline; the user reviews the result on
 * the Series screen.
 */
export class SeriesPlanner {
  private running = new Map<string, AbortController>();

  constructor(private deps: PlannerDeps) {}

  isRunning(slug: string): boolean {
    return this.running.has(slug);
  }

  /** A run that was going when the engine stopped can't be finished: back to the outline. */
  async recover(): Promise<void> {
    for (const s of await this.deps.series.list())
      if (s.outline === 'planning' && !this.running.has(s.slug))
        await this.deps.series.save({
          ...s,
          outline: s.parts.length ? 'review' : 'draft',
          planError: 'The app closed while the agent was planning. Ask it again.',
        });
  }

  async plan(slug: string, feedback?: string): Promise<Series> {
    if (this.running.has(slug))
      throw new RpcError('The agent is already planning this series.', 'bad_request');
    const series = await this.deps.series.get(slug);
    if (series.outline === 'approved')
      throw new RpcError('The outline is approved: its parts already have tutorials.', 'bad_request');
    const product = this.deps.product(series.product);
    if (!product) throw new RpcError(`unknown product "${series.product}"`, 'bad_request');
    const claude = await this.deps.claude();
    if (!claude.executable) throw new RpcError(`Claude Code was not found. ${INSTALL_CLAUDE}`, 'bad_request');
    const saved = await this.deps.series.save({ ...series, outline: 'planning', planError: null });
    const abort = new AbortController();
    this.running.set(slug, abort);
    this.deps.changed(slug);
    void this.run(saved, product, claude, abort, feedback).finally(() => this.running.delete(slug));
    return saved;
  }

  async cancel(slug: string): Promise<Series> {
    this.running.get(slug)?.abort();
    this.running.delete(slug);
    const s = await this.deps.series.get(slug);
    if (s.outline !== 'planning') return s;
    const next = await this.deps.series.save({ ...s, outline: s.parts.length ? 'review' : 'draft' });
    this.deps.changed(slug);
    return next;
  }

  /** save_series_plan: replaces the outline (refused once it's approved). */
  async saveOutline(slug: string, input: unknown): Promise<Series> {
    const plan = SeriesPlan.safeParse(input);
    if (!plan.success) throw new Error(`Invalid outline: ${formatIssues(plan.error)}`);
    const next = await this.deps.series.save(applySeriesPlan(await this.deps.series.get(slug), plan.data));
    this.deps.changed(slug);
    return next;
  }

  private async run(
    series: Series,
    product: { name: string; skill: string },
    claude: ClaudeChoice,
    abort: AbortController,
    feedback?: string,
  ) {
    const { slug } = series;
    let saved = false;
    let error: string | null = null;
    const server = createSdkMcpServer({
      name: 'series',
      version: '0.1.0',
      tools: [
        tool(
          'save_series_plan',
          'Save the series outline: the parts in order (title, goal, 2–4 learning objectives each; the id of an existing part to keep it), and optionally a better series title and notes every part shares (names, sample data, words to use). Replaces the list of parts; parts left out are dropped.',
          SeriesPlan.shape,
          async (input) => {
            try {
              const s = await this.saveOutline(slug, input);
              saved = true;
              return { content: [{ type: 'text', text: `Saved ${s.parts.length} parts.` }] };
            } catch (e) {
              return {
                content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
                isError: true,
              };
            }
          },
        ),
      ],
    });
    // Only reading and saving: anything else is refused without asking anyone.
    const canUseTool: CanUseTool = async (name, input) =>
      READ_TOOLS.includes(name) || name === SAVE_TOOL
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'Planning a series only reads the workspace and saves the outline.' };
    const options: Options = {
      cwd: this.deps.workspace,
      settingSources: ['project'],
      strictMcpConfig: true,
      settings: { disableClaudeAiConnectors: true, disableBundledSkills: true },
      skills: await this.deps.skills().catch(() => []),
      model: await this.deps.model(),
      permissionMode: 'default',
      tools: [...READ_TOOLS],
      allowedTools: [...READ_TOOLS, SAVE_TOOL],
      mcpServers: { series: server },
      canUseTool,
      maxTurns: 40,
      abortController: abort,
      env: claudeEnv(claude),
      ...(claude.executable ? { pathToClaudeCodeExecutable: claude.executable } : {}),
      stderr: (data: string) => {
        const line = data.trim();
        if (line) console.error(`[series ${slug}] ${line}`);
      },
    };
    try {
      const run = this.deps.query ?? query;
      for await (const m of run({ prompt: seriesPlanInstruction(series, product, feedback), options })) {
        for (const e of normalize(m, false)) {
          if (e.kind === 'tool_use')
            this.deps.activity(
              slug,
              e.name === SAVE_TOOL
                ? 'Saving the outline'
                : `${e.name} ${e.summary.split(this.deps.workspace + '/').join('')}`.trim(),
            );
          else if (e.kind === 'result' && !e.ok) error = e.text || `The agent stopped (${e.subtype}).`;
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) error = e instanceof Error ? e.message : String(e);
    }
    if (abort.signal.aborted) return;
    const current = await this.deps.series.get(slug).catch(() => null);
    if (!current) return;
    await this.deps.series.save({
      ...current,
      outline: current.parts.length ? 'review' : 'draft',
      planError: saved ? null : (error ?? 'The agent finished without saving an outline. Ask it again.'),
    });
    this.deps.changed(slug);
  }
}
