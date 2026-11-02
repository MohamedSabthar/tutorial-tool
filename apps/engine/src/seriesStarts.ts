import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RpcError } from '@studio/core';
import type { PartStatus, Series, SeriesPart } from '@studio/core';
import type { ProjectStore } from './projects';
import type { SeriesStore } from './series';

/** Where a part starts: its own fixture, or an earlier part's project as its recording ended. */
export type PartStart = { kind: 'clean' } | { kind: 'part'; part: SeriesPart; number: number };

/**
 * A part's `startFrom`: "clean", "previous" (the default; the first part is clean) or an earlier
 * part's id. A reference to a part that is gone or not earlier falls back to the previous part.
 */
export function resolveStart(series: Series, partId: string): PartStart {
  const i = series.parts.findIndex((p) => p.id === partId);
  const own = series.parts[i];
  if (!own || own.startFrom === 'clean' || i === 0) return { kind: 'clean' };
  const ref = series.parts.findIndex((p) => p.id === own.startFrom);
  const at = ref >= 0 && ref < i ? ref : i - 1;
  return { kind: 'part', part: series.parts[at]!, number: at + 1 };
}

const PartState = z.object({
  recordedAt: z.string(),
  /** The part this recording started from, and when that part had been recorded. */
  from: z.object({ part: z.string(), recordedAt: z.string() }).nullable(),
});
type PartState = z.infer<typeof PartState>;

/**
 * The end states series parts start from: `series/<slug>/states/<part>/project/` is the project
 * folder as the part's last recording left it, and `state.json` says when, and from what.
 */
export class SeriesStarts {
  constructor(private deps: { projects: ProjectStore; series: SeriesStore }) {}

  private dir(series: string, part: string) {
    return path.join(this.deps.series.dir(series), 'states', part);
  }

  private async read(series: string, part: string): Promise<PartState | null> {
    try {
      return PartState.parse(
        JSON.parse(await readFile(path.join(this.dir(series, part), 'state.json'), 'utf8')),
      );
    } catch {
      return null;
    }
  }

  private async write(series: string, part: string, state: PartState) {
    const file = path.join(this.dir(series, part), 'state.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2) + '\n');
    await rename(`${file}.tmp`, file);
  }

  async status(slug: string): Promise<PartStatus[]> {
    const series = await this.deps.series.get(slug);
    const states = new Map<string, PartState | null>();
    for (const p of series.parts) states.set(p.id, await this.read(slug, p.id));
    return series.parts.map((p) => {
      const start = resolveStart(series, p.id);
      const own = states.get(p.id) ?? null;
      const from = start.kind === 'part' ? (states.get(start.part.id) ?? null) : null;
      const blocked = start.kind === 'part' && !from;
      const stale =
        !!own &&
        (start.kind === 'clean'
          ? own.from !== null
          : !from || own.from?.part !== start.part.id || own.from.recordedAt !== from.recordedAt);
      return {
        part: p.id,
        start: start.kind === 'clean' ? 'clean' : start.part.id,
        recordedAt: own?.recordedAt ?? null,
        blocked,
        stale,
      };
    });
  }

  /**
   * For a run of a project: the folder it starts from (null: its own fixture), where a recording
   * saves its end state (null outside a series), and `recorded()` to call after a recording passed.
   * Throws when the part it starts from isn't recorded yet.
   */
  async forRun(project: string): Promise<{
    startFrom: string | null;
    saveEndState: string | null;
    recorded(): Promise<void>;
  } | null> {
    const { project: p } = await this.deps.projects.open(project);
    if (!p.series) return null;
    const series = await this.deps.series.get(p.series.slug).catch(() => null);
    if (!series || !series.parts.some((x) => x.id === p.series!.part)) return null;
    const { slug } = series;
    const partId = p.series.part;
    const start = resolveStart(series, partId);
    let from: PartState['from'] = null;
    if (start.kind === 'part') {
      const state = await this.read(slug, start.part.id);
      if (!state)
        throw new RpcError(
          `This part starts from part ${start.number} (“${start.part.title}”) as its recording ends, and part ${start.number} isn't recorded yet. Record it first, or set this part to start from a clean project on the Series screen.`,
          'bad_request',
        );
      from = { part: start.part.id, recordedAt: state.recordedAt };
    }
    return {
      startFrom: start.kind === 'part' ? path.join(this.dir(slug, start.part.id), 'project') : null,
      saveEndState: path.join(this.dir(slug, partId), 'project'),
      recorded: () => this.write(slug, partId, { recordedAt: new Date().toISOString(), from }),
    };
  }

  /** "It still matches": the part counts as recorded from its start part's current recording. */
  async keep(slug: string, partId: string): Promise<void> {
    const series = await this.deps.series.get(slug);
    const own = await this.read(slug, partId);
    if (!own) return;
    const start = resolveStart(series, partId);
    const from = start.kind === 'part' ? await this.read(slug, start.part.id) : null;
    await this.write(slug, partId, {
      ...own,
      from: start.kind === 'part' && from ? { part: start.part.id, recordedAt: from.recordedAt } : null,
    });
  }
}
