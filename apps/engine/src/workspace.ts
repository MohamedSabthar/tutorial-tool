import { execFile } from 'node:child_process';
import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RpcError } from '@studio/core';
import {
  PRODUCTS,
  README_KEEP,
  THEME_TS,
  WORKSPACE_CLAUDE_MD,
  WORKSPACE_GITIGNORE,
  WORKSPACE_SETTINGS,
} from './templates';

const run = promisify(execFile);

/** Seed knowledge (skills, reference projects) shipped with the app, copied into new workspaces. */
export const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed/workspace');

export interface WorkspaceStatus {
  path: string;
  initialized: boolean;
  head: string | null;
  commits: number;
}

export interface CommitInfo {
  hash: string;
  date: string;
  subject: string;
}

/**
 * The workspace is its own git repository, so Claude Code's CLAUDE.md and skill lookup
 * (which walks up to the repository root) stops at the workspace, and every knowledge
 * change the agent makes is a reviewable commit.
 */
export class Workspace {
  constructor(readonly root: string) {}

  async status(): Promise<WorkspaceStatus> {
    const initialized = await exists(path.join(this.root, '.git'));
    if (!initialized) return { path: this.root, initialized, head: null, commits: 0 };
    const head = await this.git(['rev-parse', '--short', 'HEAD']).catch(() => null);
    const count = await this.git(['rev-list', '--count', 'HEAD']).catch(() => '0');
    return { path: this.root, initialized, head, commits: Number(count) };
  }

  /** Creates the folder layout and the initial commit. Safe to call again: existing files are kept. */
  async init(): Promise<WorkspaceStatus> {
    await mkdir(this.root, { recursive: true });
    const files: [string, string][] = [
      ['CLAUDE.md', WORKSPACE_CLAUDE_MD],
      ['.claude/settings.json', JSON.stringify(WORKSPACE_SETTINGS, null, 2) + '\n'],
      ['.claude/skills/README.md', README_KEEP('Skills: one folder per product and per authoring topic')],
      ['overlays/README.md', README_KEEP('Shared overlay components')],
      ['scenes/README.md', README_KEEP('Shared explainer scenes')],
      ['theme/wso2.ts', THEME_TS],
      ['products.json', JSON.stringify(PRODUCTS, null, 2) + '\n'],
      ['projects/README.md', README_KEEP('Tutorial projects')],
      ['.gitignore', WORKSPACE_GITIGNORE],
    ];
    for (const [rel, content] of files) {
      const file = path.join(this.root, rel);
      if (await exists(file)) continue;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    await this.copySeed();
    if (!(await exists(path.join(this.root, '.git')))) {
      await this.git(['init', '-q', '-b', 'main']);
    }
    await this.commit('workspace: initialize knowledge base');
    return this.status();
  }

  /** Initializes if needed and adds any seed files the workspace doesn't have yet. */
  async ensure(): Promise<void> {
    if (!(await this.status()).initialized) {
      await this.init();
      return;
    }
    // Commit only what this added: anything else in the workspace (the agent's own skill
    // edits, scripts) is committed by whoever made it, with its own message.
    const added = await this.copySeed();
    if (await this.ensureIgnored()) added.push('.gitignore');
    if (await this.upgradeClaudeMd()) added.push('CLAUDE.md');
    if (added.length) await this.commit('workspace: add seed knowledge', added);
  }

  /**
   * Replaces a workspace CLAUDE.md still identical in substance to an older template (no lessons
   * or gotchas added, no skills map yet). Anything the agent or the user wrote is kept.
   */
  private async upgradeClaudeMd(): Promise<boolean> {
    const file = path.join(this.root, 'CLAUDE.md');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (!text || text.includes('skill-maintenance')) return false;
    const after = (heading: string) =>
      text
        .split(heading)[1]
        ?.split('\n## ')[0]
        ?.replace(/<!--[\s\S]*?-->/g, '')
        .trim();
    if (after('## Learned lessons') || after('## Gotchas')) return false;
    if (!text.startsWith('# Tutorial Studio workspace')) return false;
    await writeFile(file, WORKSPACE_CLAUDE_MD);
    return true;
  }

  /** Adds ignore rules introduced after this workspace was created. */
  private async ensureIgnored(): Promise<boolean> {
    const file = path.join(this.root, '.gitignore');
    const text = await readFile(file, 'utf8').catch(() => '');
    const have = new Set(text.split('\n').map((l) => l.trim()));
    const missing = WORKSPACE_GITIGNORE.split('\n').filter((l) => l && !l.startsWith('#') && !have.has(l));
    if (!missing.length) return false;
    await writeFile(file, `${text.replace(/\n?$/, '\n')}${missing.join('\n')}\n`);
    return true;
  }

  /** Copies seed files without overwriting anything (agent-updated skills win). Returns the added paths. */
  private async copySeed(): Promise<string[]> {
    if (!(await exists(SEED_DIR))) return [];
    const added: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      for (const e of await readdir(path.join(SEED_DIR, rel), { withFileTypes: true })) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(child);
        else if (!(await exists(path.join(this.root, child)))) {
          await mkdir(path.dirname(path.join(this.root, child)), { recursive: true });
          await cp(path.join(SEED_DIR, child), path.join(this.root, child));
          added.push(child);
        }
      }
    };
    await walk('');
    return added;
  }

  /** Stages everything (or only `paths`) and commits if anything changed. Returns the new short hash, or null. */
  async commit(message: string, paths?: string[]): Promise<string | null> {
    const spec = paths?.length ? ['--', ...paths] : [];
    await this.git(['add', '-A', ...spec]);
    const staged = await this.git(['diff', '--cached', '--name-only', ...spec]);
    if (!staged.trim()) return null;
    await this.git([...(await this.identity()), 'commit', '-q', '-m', message, ...spec]);
    return this.git(['rev-parse', '--short', 'HEAD']);
  }

  async log(limit = 20): Promise<CommitInfo[]> {
    if (!(await this.status()).initialized) return [];
    const out = await this.git(['log', `-${limit}`, '--format=%h%x09%cI%x09%s']).catch(() => '');
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash = '', date = '', subject = ''] = line.split('\t');
        return { hash, date, subject };
      });
  }

  /** Relative file paths, depth-limited, without .git and ignored media folders. */
  async tree(maxDepth = 4): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, depth: number) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (e.name === '.git' || e.name === 'node_modules' || e.name === '.DS_Store') continue;
        const abs = path.join(dir, e.name);
        const rel = path.relative(this.root, abs);
        if (e.isDirectory()) {
          out.push(rel + '/');
          if (depth < maxDepth && !/(^|\/)(recordings|audio|output)$/.test(rel)) await walk(abs, depth + 1);
        } else out.push(rel);
      }
    };
    await walk(this.root, 1);
    return out;
  }

  /** Reads a small text file inside the workspace. */
  async read(rel: string): Promise<string> {
    const file = path.resolve(this.root, rel);
    if (!file.startsWith(this.root + path.sep))
      throw new RpcError('path is outside the workspace', 'bad_request');
    if (!/\.(md|json|ts|tsx|txt|ya?ml|jsonl)$/.test(file) && path.basename(file) !== '.gitignore')
      throw new RpcError('only text files can be read', 'bad_request');
    try {
      const text = await readFile(file, 'utf8');
      return text.length > 200_000 ? text.slice(0, 200_000) + '\n… (truncated)' : text;
    } catch {
      throw new RpcError(`no file "${rel}"`, 'not_found');
    }
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await run('git', args, { cwd: this.root });
    return stdout.trim();
  }

  /** Uses the user's git identity, or a local one if none is configured. */
  private async identity(): Promise<string[]> {
    const name = await this.git(['config', 'user.name']).catch(() => '');
    const email = await this.git(['config', 'user.email']).catch(() => '');
    const args: string[] = [];
    if (!name) args.push('-c', 'user.name=Tutorial Studio');
    if (!email) args.push('-c', 'user.email=tutorial-studio@localhost');
    return args;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
