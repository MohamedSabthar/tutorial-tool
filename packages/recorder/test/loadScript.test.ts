import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadScript } from '../src/script';

let dir: string;
const page = (label: string) => `export const label = ${JSON.stringify(label)};\n`;
const script = `import type { ScriptFixture } from '@studio/recorder/node';
import { label } from './pages/page';
export const fixture: ScriptFixture = { kind: 'bi', folder: 'f', title: 'F', integrations: [] };
export default async () => label;
`;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'load-script-'));
  await mkdir(path.join(dir, 'pages'));
  await writeFile(path.join(dir, 'script.spec.ts'), script);
  await writeFile(path.join(dir, 'pages', 'page.ts'), page('Resource Path'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('loadScript', () => {
  it('picks up changes to imported page objects on the next load', async () => {
    const run = async () => (await loadScript(path.join(dir, 'script.spec.ts'))).script({} as never);
    expect(await run()).toBe('Resource Path');
    await writeFile(path.join(dir, 'pages', 'page.ts'), page('Endpoint Route'));
    expect(await run()).toBe('Endpoint Route');
  });

  it('reports syntax errors with file and line', async () => {
    await writeFile(path.join(dir, 'broken.spec.ts'), 'export const x = ;\n');
    await expect(loadScript(path.join(dir, 'broken.spec.ts'))).rejects.toThrow(/broken\.spec\.ts:1:/);
  });
});
