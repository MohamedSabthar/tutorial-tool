import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { parseTimeline, Project, RpcError, type Timeline } from '@studio/core';

/**
 * Reads and writes tutorial projects under `<workspace>/projects/<slug>/`:
 *   project.json   metadata
 *   tutorial.json  the timeline
 *   CLAUDE.md      the tutorial brief the agent reads
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

  async create(input: { title: string; product: string }): Promise<Project> {
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
    await writeFile(path.join(dir, 'CLAUDE.md'), briefTemplate(project));
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

function briefTemplate(p: Project): string {
  return `# ${p.title}

Product: ${p.product}

## Goal
What the viewer should be able to do after watching.

## Audience
Who this tutorial is for.

## Constraints
Anything the agent must do or avoid (ports, names, things to blur).
`;
}
