import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveProjectState } from '../src/script';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'studio-state-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('saveProjectState', () => {
  it('copies the project as a run left it, without build output, replacing an older copy', async () => {
    const from = path.join(dir, 'run', 'contact-sync');
    await mkdir(path.join(from, 'contact_service', 'target', 'bin'), { recursive: true });
    await writeFile(path.join(from, 'contact_service', 'main.bal'), 'service /contacts {}');
    await writeFile(path.join(from, 'contact_service', 'target', 'bin', 'app.jar'), 'jar');
    const to = path.join(dir, 'states', 'p1', 'project');
    await mkdir(to, { recursive: true });
    await writeFile(path.join(to, 'old.txt'), 'old');

    await saveProjectState(from, to);
    expect(await readFile(path.join(to, 'contact_service', 'main.bal'), 'utf8')).toBe('service /contacts {}');
    expect(existsSync(path.join(to, 'contact_service', 'target'))).toBe(false);
    expect(existsSync(path.join(to, 'old.txt'))).toBe(false);
  });
});
