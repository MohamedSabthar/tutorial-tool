import { mkdir, readdir, readFile, writeFile, access, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Brief, briefTitle, parseTimeline, Project, RpcError, type Timeline } from '@studio/core';
import { projectClaudeMd } from './templates';
import { renderBrief } from './brief';

const MAX_REFERENCE_BYTES = 5 << 20;

/**
 * Reads and writes tutorial projects under `<workspace>/projects/<slug>/`:
 *   project.json   metadata
 *   tutorial.json  the timeline
 *   brief.json     the brief form (Brief screen)
 *   CLAUDE.md      the tutorial brief the agent reads (brief sections rendered from brief.json)
 *   references/    files attached to the brief
 */
export class ProjectStore {
  constructor(readonly workspace: string) {}

  get root(): string {
    return path.join(this.workspace, 'projects');
  }

  dir(slug: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug))
      throw new RpcError(`invalid project slug "${slug}"`, 'bad_request');
    return path.join(this.root, slug);
  }

  async list(): Promise<Project[]> {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const projects: Project[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        projects.push(await this.readProject(e.name));
      } catch {
        // Skip folders that are not projects.
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: { title: string; product: string; brief?: Partial<Brief> }): Promise<Project> {
    await mkdir(this.root, { recursive: true });
    const slug = await this.uniqueSlug(slugify(input.title));
    const now = new Date().toISOString();
    const project = Project.parse({
      slug,
      title: input.title,
      product: input.product,
      createdAt: now,
      updatedAt: now,
    });
    const dir = this.dir(slug);
    await mkdir(dir, { recursive: true });
    await writeJson(path.join(dir, 'project.json'), project);
    await writeJson(path.join(dir, 'tutorial.json'), parseTimeline({ version: 1 }));
    await writeFile(path.join(dir, 'CLAUDE.md'), projectClaudeMd(project));
    // New briefs start with the voice used last.
    const voice = input.brief?.voice ?? (await this.defaultVoice());
    if (input.brief || voice) await this.saveBrief(slug, Brief.parse({ ...input.brief, voice }));
    return project;
  }

  /** Workspace preferences that aren't knowledge (git-ignored): the default voice. */
  private get settingsFile() {
    return path.join(this.workspace, '.studio', 'settings.json');
  }

  /** The voice last chosen in any brief: the default for briefs without one. */
  async defaultVoice(): Promise<string | null> {
    try {
      const v = (JSON.parse(await readFile(this.settingsFile, 'utf8')) as { defaultVoice?: unknown }).defaultVoice;
      return typeof v === 'string' && v ? v : null;
    } catch {
      return null;
    }
  }

  private async setDefaultVoice(voice: string) {
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(await readFile(this.settingsFile, 'utf8')) as Record<string, unknown>;
    } catch {
      // First setting.
    }
    if (settings.defaultVoice === voice) return;
    await mkdir(path.dirname(this.settingsFile), { recursive: true });
    await writeFile(this.settingsFile, JSON.stringify({ ...settings, defaultVoice: voice }, null, 2) + '\n');
  }

  /** The voice for a project's voice-over: its brief's, or the default. */
  async voiceFor(slug: string): Promise<string | null> {
    return (await this.readBrief(slug)).voice ?? (await this.defaultVoice());
  }

  async readBrief(slug: string): Promise<Brief> {
    try {
      return Brief.parse(JSON.parse(await readFile(path.join(this.dir(slug), 'brief.json'), 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.readProject(slug);
        return Brief.parse({ voice: await this.defaultVoice() });
      }
      throw e;
    }
  }

  /** Saves brief.json, renders it into CLAUDE.md, and retitles drafts from the goal. */
  async saveBrief(slug: string, brief: Brief): Promise<Brief> {
    const project = await this.readProject(slug);
    const dir = this.dir(slug);
    await writeJson(path.join(dir, 'brief.json'), brief);
    if (brief.voice) await this.setDefaultVoice(brief.voice);
    const mdFile = path.join(dir, 'CLAUDE.md');
    const md = await readFile(mdFile, 'utf8').catch(() => projectClaudeMd(project));
    const title = project.status === 'draft' && brief.goal.trim() ? briefTitle(brief.goal) : project.title;
    await writeFile(mdFile, renderBrief(md, { ...project, title }, brief));
    await writeJson(
      path.join(dir, 'project.json'),
      Project.parse({ ...project, title, updatedAt: new Date().toISOString() }),
    );
    return brief;
  }

  /** Copies a file into references/ (or records a link) and adds it to the brief. */
  async addReference(
    slug: string,
    source:
      | { kind: 'url'; url: string }
      | { kind: 'path'; path: string }
      | { kind: 'data'; name: string; base64: string },
  ): Promise<Brief> {
    const brief = await this.readBrief(slug);
    if (source.kind === 'url') {
      if (brief.references.some((r) => r.kind === 'url' && r.url === source.url)) return brief;
      return this.saveBrief(slug, {
        ...brief,
        references: [...brief.references, { kind: 'url', url: source.url }],
      });
    }
    const name = path
      .basename(source.kind === 'path' ? source.path : source.name)
      .replace(/[^\w.@ -]+/g, '_');
    if (!name || name.startsWith('.')) throw new RpcError('that file name cannot be used', 'bad_request');
    const dir = path.join(this.dir(slug), 'references');
    await mkdir(dir, { recursive: true });
    const rel = `references/${name}`;
    if (source.kind === 'path') {
      const st = await stat(source.path).catch(() => null);
      if (!st?.isFile()) throw new RpcError(`not a file: ${source.path}`, 'bad_request');
      if (st.size > MAX_REFERENCE_BYTES) throw new RpcError(`${name} is larger than 5 MB`, 'bad_request');
      await copyFile(source.path, path.join(this.dir(slug), rel));
    } else {
      const data = Buffer.from(source.base64, 'base64');
      if (data.length > MAX_REFERENCE_BYTES) throw new RpcError(`${name} is larger than 5 MB`, 'bad_request');
      await writeFile(path.join(this.dir(slug), rel), data);
    }
    const references = brief.references.filter((r) => !(r.kind === 'file' && r.path === rel));
    return this.saveBrief(slug, { ...brief, references: [...references, { kind: 'file', name, path: rel }] });
  }

  /** Removes a reference from the brief (the copied file stays in references/). */
  async removeReference(slug: string, index: number): Promise<Brief> {
    const brief = await this.readBrief(slug);
    if (!brief.references[index]) throw new RpcError('no such reference', 'not_found');
    return this.saveBrief(slug, { ...brief, references: brief.references.filter((_, i) => i !== index) });
  }

  /** Returns the project with this slug, creating it if needed (used for built-in sample projects). */
  async ensure(slug: string, title: string, product: string): Promise<Project> {
    try {
      return await this.readProject(slug);
    } catch {
      const now = new Date().toISOString();
      const project = Project.parse({ slug, title, product, createdAt: now, updatedAt: now });
      const dir = this.dir(slug);
      await mkdir(dir, { recursive: true });
      await writeJson(path.join(dir, 'project.json'), project);
      await writeJson(path.join(dir, 'tutorial.json'), parseTimeline({ version: 1 }));
      await writeFile(path.join(dir, 'CLAUDE.md'), projectClaudeMd(project));
      return project;
    }
  }

  /** The next free take id under recordings/ (take-1, take-2, …). */
  async nextTakeId(slug: string): Promise<string> {
    const dir = path.join(this.dir(slug), 'recordings');
    await mkdir(dir, { recursive: true });
    const used = (await readdir(dir))
      .map((n) => /^take-(\d+)$/.exec(n)?.[1])
      .filter(Boolean)
      .map(Number);
    return `take-${(used.length ? Math.max(...used) : 0) + 1}`;
  }

  /** Updates the status chip shown on project cards. */
  async setStatus(slug: string, status: Project['status']): Promise<Project> {
    const project = Project.parse({
      ...(await this.readProject(slug)),
      status,
      updatedAt: new Date().toISOString(),
    });
    await writeJson(path.join(this.dir(slug), 'project.json'), project);
    return project;
  }

  async open(slug: string): Promise<{ project: Project; timeline: Timeline }> {
    const project = await this.readProject(slug);
    const raw = JSON.parse(await readFile(path.join(this.dir(slug), 'tutorial.json'), 'utf8')) as unknown;
    return { project, timeline: parseTimeline(raw) };
  }

  private async readProject(slug: string): Promise<Project> {
    const file = path.join(this.dir(slug), 'project.json');
    try {
      return Project.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new RpcError(`no project "${slug}"`, 'not_found');
      throw e;
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      try {
        await access(this.dir(slug));
      } catch {
        return slug;
      }
    }
  }
}

export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'tutorial';
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}
