import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skillCommitSubject, WorkspaceGit } from '../src/workspaceGit';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'wsgit-'));
  await mkdir(path.join(dir, '.claude/skills/wso2-integrator/pages'), { recursive: true });
  await writeFile(path.join(dir, '.claude/skills/wso2-integrator/pages/http-service.ts'), 'old\n');
  await writeFile(path.join(dir, 'CLAUDE.md'), '# ws\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git(...id, 'commit', '-q', '-m', 'init');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('WorkspaceGit', () => {
  it('commits only skill changes, with a structured message', async () => {
    const ws = new WorkspaceGit(dir);
    const before = await ws.head();
    await writeFile(path.join(dir, '.claude/skills/wso2-integrator/pages/http-service.ts'), 'new\n');
    await writeFile(path.join(dir, '.claude/skills/wso2-integrator/components.md'), 'notes\n');
    await writeFile(path.join(dir, 'CLAUDE.md'), '# ws edited\n');
    expect((await ws.changedSkills()).sort()).toEqual([
      '.claude/skills/wso2-integrator/components.md',
      '.claude/skills/wso2-integrator/pages/http-service.ts',
    ]);
    const c = await ws.commitSkills('Fixed the Resource Path locator. It was renamed.', '1.127.0');
    expect(c?.subject).toBe('skills(wso2-integrator): fixed the Resource Path locator [1.127.0]');
    expect(await ws.changedSkills()).toEqual([]);
    expect(git('status', '--porcelain')).toBe('M CLAUDE.md');
    expect((await ws.skillCommitsSince(before)).map((x) => x.subject)).toEqual([c!.subject]);
    expect(await ws.commitSkills('nothing', null)).toBeNull();
  });

  it('shortens long summaries', () => {
    const s = skillCommitSubject(['a', 'b'], 'x'.repeat(100), null);
    expect(s.startsWith('skills(a,b): ')).toBe(true);
    expect(s.length).toBeLessThan(90);
  });
});
