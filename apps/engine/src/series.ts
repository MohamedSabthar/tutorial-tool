import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applySeriesEdit,
  briefTitle,
  RpcError,
  Series,
  SeriesBrief,
  SLUG_RE,
  type SeriesEdit,
} from '@studio/core';
import { slugify } from './projects';

/**
 * Reads and writes tutorial series under `<workspace>/series/<slug>/series.json`. A series is an
 * ordered list of parts with a shared brief; each part becomes a project once the outline is
 * approved (the project's `series` field points back here).
 */
export class SeriesStore {
  constructor(readonly workspace: string) {}

  get root(): string {
    return path.join(this.workspace, 'series');
  }

  dir(slug: string): string {
    if (!SLUG_RE.test(slug)) throw new RpcError(`invalid series slug "${slug}"`, 'bad_request');
    return path.join(this.root, slug);
  }

  async list(): Promise<Series[]> {
    await mkdir(this.root, { recursive: true });
    const out: Series[] = [];
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      try {
        out.push(await this.get(e.name));
      } catch {
        // Not a series folder.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: { topic: string; product: string; brief?: Partial<SeriesBrief> }): Promise<Series> {
    await mkdir(this.root, { recursive: true });
    const title = briefTitle(input.topic).replace('Untitled tutorial', 'Untitled series');
    const slug = await this.uniqueSlug(slugify(title));
    const now = new Date().toISOString();
    const series = Series.parse({
      slug,
      title,
      topic: input.topic.trim(),
      product: input.product,
      brief: SeriesBrief.parse(input.brief ?? {}),
      createdAt: now,
      updatedAt: now,
    });
    await mkdir(this.dir(slug), { recursive: true });
    await this.write(series);
    return series;
  }

  async get(slug: string): Promise<Series> {
    try {
      return Series.parse(JSON.parse(await readFile(this.file(slug), 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new RpcError(`no series "${slug}"`, 'not_found');
      throw e;
    }
  }

  async edit(slug: string, edit: SeriesEdit): Promise<Series> {
    const current = await this.get(slug);
    let next: Series;
    try {
      next = applySeriesEdit(current, edit);
    } catch (e) {
      throw new RpcError(e instanceof Error ? e.message : String(e), 'bad_request');
    }
    return this.save(next);
  }

  /** Writes the series as given (stamping updatedAt). */
  async save(series: Series): Promise<Series> {
    const next = Series.parse({ ...series, updatedAt: new Date().toISOString() });
    await this.write(next);
    return next;
  }

  async remove(slug: string): Promise<Series> {
    const series = await this.get(slug);
    await rm(this.dir(slug), { recursive: true, force: true });
    return series;
  }

  private file(slug: string) {
    return path.join(this.dir(slug), 'series.json');
  }

  private async write(series: Series) {
    const f = this.file(series.slug);
    await writeFile(`${f}.tmp`, JSON.stringify(series, null, 2) + '\n');
    await rename(`${f}.tmp`, f);
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
