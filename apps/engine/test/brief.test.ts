import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Brief, briefTitle } from '@studio/core';
import { ProjectStore } from '../src/projects';
import { setSections, skillCoverage } from '../src/brief';

describe('brief', () => {
  let ws: string;
  let store: ProjectStore;
  beforeEach(async () => {
    ws = await mkdtemp(path.join(os.tmpdir(), 'brief-'));
    store = new ProjectStore(ws);
  });
  afterEach(() => rm(ws, { recursive: true, force: true }));

  it('titles drafts from the first sentence of the goal', () => {
    expect(briefTitle('Create an HTTP service. Then call it.')).toBe('Create an HTTP service');
    expect(briefTitle('')).toBe('Untitled tutorial');
    expect(briefTitle('a '.repeat(50)).length).toBeLessThanOrEqual(61);
  });

  it('replaces brief sections and keeps the rest of CLAUDE.md', () => {
    const md = '# T\n\n## Goal\nold\n\n## Outline\n- s1\n\n## Notes\nkeep me\n';
    const out = setSections(md, { Goal: 'new goal', References: 'None.' });
    expect(out).toBe(
      '# T\n\n## Goal\n\nnew goal\n\n## References\n\nNone.\n\n## Outline\n- s1\n\n## Notes\nkeep me\n',
    );
  });

  it('saves the brief into brief.json and CLAUDE.md, and retitles the draft', async () => {
    const p = await store.create({
      title: 'x',
      product: 'wso2-integrator',
      brief: { goal: 'Create an HTTP service.' },
    });
    const brief = Brief.parse({
      goal: 'Build a greeting API. It returns JSON.',
      audience: 'new',
      length: 'short',
      explainers: false,
      notes: 'Use port 9090.',
    });
    await store.saveBrief(p.slug, brief);
    expect(await store.readBrief(p.slug)).toEqual(brief);
    const md = await readFile(path.join(store.dir(p.slug), 'CLAUDE.md'), 'utf8');
    expect(md).toMatch(/^# Build a greeting API\n/);
    expect(md).toContain('## Goal\n\nBuild a greeting API. It returns JSON.');
    expect(md).toContain('People new to WSO2');
    expect(md).toContain('- Length: About 1 minute.');
    expect(md).toContain("Explainers: don't propose any");
    expect(md).toContain('Use port 9090.');
    expect(md).toContain('## Outline');
    expect((await store.open(p.slug)).project.title).toBe('Build a greeting API');
  });

  it('remembers the last voice as the default for other tutorials', async () => {
    const a = await store.create({ title: 'A', product: 'wso2-integrator' });
    const b = await store.create({ title: 'B', product: 'wso2-integrator' });
    expect(await store.voiceFor(b.slug)).toBeNull();
    await store.saveBrief(a.slug, Brief.parse({ goal: 'x', voice: 'voice-1' }));
    expect(await store.voiceFor(b.slug)).toBe('voice-1');
    expect((await store.readBrief(b.slug)).voice).toBe('voice-1');
    const c = await store.create({ title: 'C', product: 'wso2-integrator', brief: { goal: 'y' } });
    expect((await store.readBrief(c.slug)).voice).toBe('voice-1');
  });

  it('adds file and link references', async () => {
    const p = await store.create({ title: 'x', product: 'wso2-integrator' });
    const src = path.join(ws, 'guide.md');
    await writeFile(src, '# Guide');
    await store.addReference(p.slug, { kind: 'path', path: src });
    await store.addReference(p.slug, {
      kind: 'data',
      name: '../evil name.txt',
      base64: Buffer.from('hi').toString('base64'),
    });
    const b = await store.addReference(p.slug, { kind: 'url', url: 'https://bi.docs.wso2.com/http' });
    expect(b.references).toEqual([
      { kind: 'file', name: 'guide.md', path: 'references/guide.md' },
      { kind: 'file', name: 'evil name.txt', path: 'references/evil name.txt' },
      { kind: 'url', url: 'https://bi.docs.wso2.com/http' },
    ]);
    expect(await readFile(path.join(store.dir(p.slug), 'references/evil name.txt'), 'utf8')).toBe('hi');
    expect(await readFile(path.join(store.dir(p.slug), 'CLAUDE.md'), 'utf8')).toContain(
      '- references/guide.md',
    );
    expect((await store.removeReference(p.slug, 0)).references).toHaveLength(2);
  });

  it('reports skill coverage and which notes match the goal', async () => {
    await writeFile(
      path.join(ws, 'products.json'),
      JSON.stringify({
        products: [{ id: 'wso2-integrator', name: 'WSO2 Integrator', skill: 'wso2-integrator' }],
      }),
    );
    const dir = path.join(ws, '.claude/skills/wso2-integrator/components');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'http-service.md'),
      '---\ncomponent: http-service\nlast_verified: 2026-10-16\n---\n\n# HTTP service\n\n## Flow\n',
    );
    await writeFile(path.join(dir, 'data-mapper.md'), '# Data mapper\n');
    const c = await skillCoverage(ws, 'wso2-integrator', 'Create an HTTP service with a GET resource');
    expect(c.skill).toBe('wso2-integrator');
    expect(c.items).toEqual([
      { name: 'data-mapper', title: 'Data mapper', lastVerified: null, relevant: false },
      { name: 'http-service', title: 'HTTP service', lastVerified: '2026-10-16', relevant: true },
    ]);
    expect((await skillCoverage(ws, 'other', 'x')).skill).toBeNull();
  });
});
