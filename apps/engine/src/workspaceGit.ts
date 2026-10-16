import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface SkillCommit {
  hash: string;
  subject: string;
}

/**
 * Knowledge commits in the workspace repo: product skills change only through structured
 * commits (`skills(<product>): <what changed> [<product version>]`), so the history reads as a
 * changelog of what the agent learned.
 */
export class WorkspaceGit {
  constructor(private root: string) {}

  private async git(args: string[], trim = true): Promise<string> {
    const { stdout } = await run('git', args, { cwd: this.root });
    return trim ? stdout.trim() : stdout;
  }

  private async identity(): Promise<string[]> {
    const name = await this.git(['config', 'user.name']).catch(() => '');
    const email = await this.git(['config', 'user.email']).catch(() => '');
    return [
      ...(name ? [] : ['-c', 'user.name=Tutorial Studio']),
      ...(email ? [] : ['-c', 'user.email=tutorial-studio@localhost']),
    ];
  }

  async head(): Promise<string | null> {
    return this.git(['rev-parse', '--short', 'HEAD']).catch(() => null);
  }

  /** Skill files with uncommitted changes (relative paths). */
  async changedSkills(): Promise<string[]> {
    // Untrimmed: porcelain lines start with a status column that may be a space.
    const out = await this.git(
      ['status', '--porcelain', '--untracked-files=all', '--', '.claude/skills'],
      false,
    ).catch(() => '');
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, ''));
  }

  /** Skill commits made after `since` (a commit hash), newest first. */
  async skillCommitsSince(since: string | null): Promise<SkillCommit[]> {
    const range = since ? [`${since}..HEAD`] : ['-20'];
    const out = await this.git(['log', ...range, '--format=%h%x09%s', '--', '.claude/skills']).catch(
      () => '',
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash = '', subject = ''] = l.split('\t');
        return { hash, subject };
      });
  }

  /**
   * Commits uncommitted skill changes (only those), naming the product from the paths.
   * Returns null when nothing changed.
   */
  async commitSkills(summary: string, version: string | null): Promise<SkillCommit | null> {
    const files = await this.changedSkills();
    if (!files.length) return null;
    const products = [...new Set(files.map((f) => f.split('/')[2]).filter((p): p is string => !!p))];
    const subject = skillCommitSubject(products, summary, version);
    await this.git(['add', '-A', '--', '.claude/skills']);
    await this.git([...(await this.identity()), 'commit', '-q', '-m', subject, '--', '.claude/skills']);
    return { hash: (await this.head()) ?? '', subject };
  }

  /**
   * Uncommitted changes to the knowledge base (workspace CLAUDE.md and skills) as a unified
   * diff, new files included. Capped so it fits a gate.
   */
  async knowledgeDiff(max = 20000): Promise<string> {
    // Intent-to-add makes new files show up in the diff without staging their content.
    await this.git(['add', '-N', '--', ...KNOWLEDGE]).catch(() => '');
    const diff = await this.git(['diff', '--no-color', '--', ...KNOWLEDGE], false).catch(() => '');
    return diff.length > max ? `${diff.slice(0, max)}\n… (diff truncated)` : diff;
  }

  /** Commits the knowledge base changes (CLAUDE.md and skills) with `message`. */
  async commitKnowledge(message: string): Promise<SkillCommit | null> {
    if (!(await this.knowledgeDiff(1))) return null;
    await this.git(['add', '-A', '--', ...KNOWLEDGE]);
    await this.git([...(await this.identity()), 'commit', '-q', '-m', message, '--', ...KNOWLEDGE]);
    return { hash: (await this.head()) ?? '', subject: message };
  }

  /** Throws away uncommitted knowledge changes (a rejected retrospective). */
  async discardKnowledge(): Promise<void> {
    await this.git(['checkout', '--', ...KNOWLEDGE]).catch(() => '');
    await this.git(['clean', '-fdq', '--', '.claude/skills']).catch(() => '');
  }

  async show(hash: string): Promise<{ hash: string; subject: string; date: string; diff: string }> {
    const head = await this.git(['show', '-s', '--format=%h%x09%cI%x09%s', hash]);
    const [h = hash, date = '', subject = ''] = head.split('\t');
    const diff = await this.git(['show', '--no-color', '--format=', hash], false);
    return {
      hash: h,
      subject,
      date,
      diff: diff.length > 60000 ? `${diff.slice(0, 60000)}\n… (truncated)` : diff,
    };
  }
}

const KNOWLEDGE = ['CLAUDE.md', '.claude/skills'];

/**
 * The agent's one-line description, as a commit subject body: first sentence, no commit-style
 * prefix it may have added itself ("skills(x):", "lessons:") and no trailing "[version]".
 */
export function knowledgeLine(text: string, max = 72): string {
  let line = text.split(/(?<=[.!?])\s/)[0]!.trim();
  for (let i = 0; i < 3; i++) line = line.replace(/^(skills\([^)]*\)|lessons|knowledge)\s*:\s*/i, '');
  line = line.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/[.\s]+$/, '');
  line = line.charAt(0).toLowerCase() + line.slice(1);
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** `skills(wso2-integrator): fix the resource path field locator [1.127.0]` */
export function skillCommitSubject(products: string[], summary: string, version: string | null): string {
  return `skills(${products.join(',') || 'unknown'}): ${knowledgeLine(summary) || 'update'}${version ? ` [${version}]` : ''}`;
}
