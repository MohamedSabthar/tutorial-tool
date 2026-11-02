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
