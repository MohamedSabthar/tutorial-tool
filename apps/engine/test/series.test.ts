import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySeriesPlan, partGoal, type Series } from '@studio/core';
import { SeriesStore } from '../src/series';
import { SeriesPlanner, seriesPlanInstruction } from '../src/seriesPlanner';

let dir: string;
let store: SeriesStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'studio-series-'));
  store = new SeriesStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const plan = {
  title: 'Your first integration',
  notes: 'Project: greeting-project.',
  parts: [
    { title: 'Create an HTTP service', goal: 'A GET /greeting resource.', objectives: ['Add a service'] },
    {
      title: 'Call an API',
      goal: 'Call a translation API.',
      objectives: ['Add a connection', 'Handle errors'],
    },
  ],
};

function planner(over: Partial<ConstructorParameters<typeof SeriesPlanner>[0]> = {}) {
  const changes: string[] = [];
  const p = new SeriesPlanner({
    workspace: dir,
    series: store,
    product: () => ({ name: 'WSO2 Integrator', skill: 'wso2-integrator' }),
    claude: async () => ({ executable: '/bin/true', configDir: null }),
    model: async () => 'claude-opus-5-5',
    skills: async () => [],
    changed: (slug) => changes.push(slug),
    activity: () => undefined,
    // An agent run that ends without saving anything.
    query: (() => (async function* () {})()) as never,
    ...over,
  });
  return { p, changes };
}

const settle = async (p: SeriesPlanner, slug: string) => {
  for (let i = 0; i < 50 && p.isRunning(slug); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('series outline', () => {
  it('asks for parts grounded in the product skill, with the current outline and feedback on a revision', async () => {
    let s = await store.create({ topic: 'Build your first integration', product: 'wso2-integrator' });
    expect(seriesPlanInstruction(s, { name: 'WSO2 Integrator', skill: 'wso2-integrator' })).toContain(
      '.claude/skills/wso2-integrator/SKILL.md',
    );
    s = applySeriesPlan(s, plan);
    const text = seriesPlanInstruction(s, { name: 'WSO2 Integrator', skill: 'wso2-integrator' }, 'Add MySQL');
    expect(text).toContain('revise the outline');
    expect(text).toContain('"Call an API"');
    expect(text).toContain('Add MySQL');
  });

  it('saves an outline from the agent, replacing the parts', async () => {
    const s = await store.create({ topic: 'x', product: 'wso2-integrator' });
    const { p, changes } = planner();
    const saved = await p.saveOutline(s.slug, plan);
    expect(saved.title).toBe('Your first integration');
    expect(saved.parts.map((x) => [x.id, x.title])).toEqual([
      ['p1', 'Create an HTTP service'],
      ['p2', 'Call an API'],
    ]);
    expect(changes).toContain(s.slug);
    await expect(p.saveOutline(s.slug, { parts: [] })).rejects.toThrow(/Invalid outline/);
  });

  it('reports a run that ends without an outline, and goes back to draft', async () => {
    const s = await store.create({ topic: 'x', product: 'wso2-integrator' });
    const { p } = planner();
    expect((await p.plan(s.slug)).outline).toBe('planning');
    await expect(p.plan(s.slug)).rejects.toThrow(/already planning/);
    await settle(p, s.slug);
    const after = await store.get(s.slug);
    expect(after.outline).toBe('draft');
    expect(after.planError).toMatch(/without saving/);
  });

  it('needs Claude Code to plan', async () => {
    const s = await store.create({ topic: 'x', product: 'wso2-integrator' });
    const { p } = planner({ claude: async () => ({ executable: null, configDir: null }) });
    await expect(p.plan(s.slug)).rejects.toThrow(/Claude Code was not found/);
    expect((await store.get(s.slug)).outline).toBe('draft');
  });

  it('recovers a run the engine lost', async () => {
    const s = await store.create({ topic: 'x', product: 'wso2-integrator' });
    await store.save({ ...applySeriesPlan(s, plan), outline: 'planning' } satisfies Series);
    await planner().p.recover();
    expect(await store.get(s.slug)).toMatchObject({
      outline: 'review',
      planError: expect.stringMatching(/closed/),
    });
  });

  it("writes a part's goal with its objectives", async () => {
    const part = applySeriesPlan(await store.create({ topic: 'x', product: 'p' }), plan).parts[1]!;
    expect(partGoal(part)).toBe(
      'Call a translation API.\n\nBy the end, viewers can: Add a connection; Handle errors.',
    );
  });
});

describe('series context', () => {
  it("writes each part's place, what came before and what comes next into its CLAUDE.md", async () => {
    const { ProjectStore } = await import('../src/projects');
    const { SeriesContext, seriesSection } = await import('../src/seriesContext');
    const { planInstruction, narrateInstruction } = await import('../src/pipeline/instructions');
    const projects = new ProjectStore(dir);
    let s = applySeriesPlan(await store.create({ topic: 'x', product: 'wso2-integrator' }), {
      ...plan,
      parts: [...plan.parts, { title: 'Store it in MySQL', goal: 'Insert a row.', objectives: ['Insert'] }],
    });
    const parts = [];
    for (const part of s.parts) {
      const p = await projects.create({
        title: part.title,
        product: s.product,
        brief: { goal: partGoal(part) },
      });
      await projects.setSeries(p.slug, { slug: s.slug, part: part.id });
      parts.push({ ...part, project: p.slug });
    }
    s = await store.save({ ...s, parts, outline: 'approved' });

    const summaries: Record<string, string> = {
      [parts[0]!.project]: 'Builds greeting_service on port 9090.',
    };
    const ctx = new SeriesContext({
      projects,
      series: store,
      planSummary: async (p) => summaries[p] ?? null,
    });
    await ctx.syncSeries(s.slug);
    const { readFile } = await import('node:fs/promises');
    const md = (slug: string) => readFile(path.join(projects.dir(slug), 'CLAUDE.md'), 'utf8');

    const second = await md(parts[1]!.project);
    expect(second).toContain('## Series');
    expect(second).toContain('part 2 of 3 in the series "Your first integration"');
    // A planned part is summarised by its plan, an unplanned one by its objectives.
    expect(second).toContain('- Part 1 · Create an HTTP service: Builds greeting_service on port 9090.');
    expect(second).toContain('Next: part 3 · Store it in MySQL (Insert a row.)');
    expect(second).toContain('Project: greeting-project.');
    expect(await md(parts[0]!.project)).toContain('This is the first part');
    expect(await md(parts[2]!.project)).toContain('This is the last part');
    expect(await md(parts[2]!.project)).toContain('- Part 2 · Call an API: Add a connection; Handle errors');

    // Saving the brief keeps the section; leaving the series removes it.
    await projects.saveBrief(parts[1]!.project, await projects.readBrief(parts[1]!.project));
    expect(await md(parts[1]!.project)).toContain('## Series');
    await ctx.clear(parts[1]!.project);
    expect(await md(parts[1]!.project)).not.toContain('## Series');
    expect(await seriesSection(s, 'p9', async () => null)).toBe('');

    expect(planInstruction({ explainers: true, series: true })).toContain('Series section');
    expect(planInstruction({ explainers: true })).not.toContain('Series section');
    expect(narrateInstruction({ summary: '', steps: [], explainers: [] }, [], { series: true })).toContain(
      'leads into the next part',
    );
  });
});
