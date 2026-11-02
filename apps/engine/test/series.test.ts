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

describe('where parts start', () => {
  it('resolves starts, blocks a part until its start is recorded, and flags out-of-date parts', async () => {
    const { ProjectStore } = await import('../src/projects');
    const { SeriesStarts, resolveStart } = await import('../src/seriesStarts');
    const projects = new ProjectStore(dir);
    let s = applySeriesPlan(await store.create({ topic: 'x', product: 'wso2-integrator' }), {
      ...plan,
      parts: [...plan.parts, { title: 'Three', goal: 'g', objectives: ['o'] }],
    });
    const parts = [];
    for (const part of s.parts) {
      const p = await projects.create({
        title: part.title,
        product: s.product,
        series: { slug: s.slug, part: part.id },
      });
      parts.push({ ...part, project: p.slug });
    }
    s = await store.save({ ...s, parts, outline: 'approved' });
    const starts = new SeriesStarts({ projects, series: store });

    expect(resolveStart(s, 'p1')).toEqual({ kind: 'clean' });
    expect(resolveStart(s, 'p3')).toMatchObject({ kind: 'part', number: 2 });
    // An earlier part by id; a reference that isn't earlier falls back to the previous part.
    expect(
      resolveStart(
        { ...s, parts: s.parts.map((p) => (p.id === 'p3' ? { ...p, startFrom: 'p1' } : p)) },
        'p3',
      ),
    ).toMatchObject({ number: 1 });
    expect(
      resolveStart(
        { ...s, parts: s.parts.map((p) => (p.id === 'p2' ? { ...p, startFrom: 'p3' } : p)) },
        'p2',
      ),
    ).toMatchObject({ number: 1 });

    // Part 2 waits for part 1.
    expect((await starts.status(s.slug)).map((x) => [x.part, x.start, x.blocked])).toEqual([
      ['p1', 'clean', false],
      ['p2', 'p1', true],
      ['p3', 'p2', true],
    ]);
    await expect(starts.forRun(parts[1]!.project)).rejects.toThrow(/part 1 .* isn't recorded yet/);

    const one = (await starts.forRun(parts[0]!.project))!;
    expect(one.startFrom).toBeNull();
    expect(one.saveEndState).toMatch(/states\/p1\/project$/);
    await one.recorded();
    const two = (await starts.forRun(parts[1]!.project))!;
    expect(two.startFrom).toMatch(/states\/p1\/project$/);
    await two.recorded();
    expect((await starts.status(s.slug)).map((x) => [x.blocked, x.stale])).toEqual([
      [false, false],
      [false, false],
      [false, false],
    ]);

    // Recording part 1 again makes part 2 out of date, until the user keeps it.
    await new Promise((r) => setTimeout(r, 5));
    await (await starts.forRun(parts[0]!.project))!.recorded();
    expect((await starts.status(s.slug))[1]!.stale).toBe(true);
    await starts.keep(s.slug, 'p2');
    expect((await starts.status(s.slug))[1]!.stale).toBe(false);

    // Switching part 2 to a clean start also makes its recording out of date.
    s = await store.save({
      ...s,
      parts: s.parts.map((p) => (p.id === 'p2' ? { ...p, startFrom: 'clean' } : p)),
    });
    expect((await starts.status(s.slug))[1]).toMatchObject({ start: 'clean', stale: true, blocked: false });
    expect(await starts.forRun('not-in-a-series').catch(() => 'missing')).toBe('missing');
  });

  it('tells the agent where a part starts', async () => {
    const { seriesSection } = await import('../src/seriesContext');
    let s = applySeriesPlan(await store.create({ topic: 'x', product: 'p' }), plan);
    s = { ...s, parts: s.parts.map((p, i) => ({ ...p, project: `proj-${i + 1}` })) };
    expect(await seriesSection(s, 'p2', async () => null)).toContain(
      "open part 1's project as its recording ended (built by projects/proj-1/script.spec.ts)",
    );
    s = { ...s, parts: s.parts.map((p) => (p.id === 'p2' ? { ...p, startFrom: 'clean' } : p)) };
    expect(await seriesSection(s, 'p2', async () => null)).toContain('its own fixture, a clean project');
  });
});
