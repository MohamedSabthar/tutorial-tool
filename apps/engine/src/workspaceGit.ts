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
}

/** `skills(wso2-integrator): fix the resource path field locator [1.127.0]` */
export function skillCommitSubject(products: string[], summary: string, version: string | null): string {
  const first = summary.split(/(?<=[.!?])\s/)[0]!.replace(/[.\s]+$/, '');
  const text = first.charAt(0).toLowerCase() + first.slice(1);
  const short = text.length > 72 ? `${text.slice(0, 71)}…` : text;
  return `skills(${products.join(',') || 'unknown'}): ${short || 'update'}${version ? ` [${version}]` : ''}`;
}
