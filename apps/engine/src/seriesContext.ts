import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { partContext, type Series, type SeriesPart } from '@studio/core';
import { setSections } from './brief';
import { resolveStart } from './seriesStarts';
import type { ProjectStore } from './projects';
import type { SeriesStore } from './series';

/** What a part covers: the summary of its saved plan once planned, else its objectives or goal. */
export type PartSummary = (part: SeriesPart) => Promise<string | null>;

const covers = async (part: SeriesPart, summary: PartSummary) => {
  const planned = await summary(part).catch(() => null);
  if (planned?.trim()) return planned.trim();
  if (part.objectives.length) return part.objectives.join('; ');
  return part.goal.trim() || part.title;
};

/** The "## Series" section of a part's CLAUDE.md: its place, what came before and what comes next. */
export async function seriesSection(series: Series, partId: string, summary: PartSummary): Promise<string> {
  const ctx = partContext(series, partId);
  if (!ctx) return '';
  const lines = [
    `This tutorial is part ${ctx.number} of ${ctx.total} in the series "${series.title}". Viewers may have watched the earlier parts.`,
  ];
  if (ctx.previous.length) {
    lines.push(
      '',
      "Already covered by earlier parts: don't teach these again. Where it helps, recap them in one line at the start.",
    );
    for (const [i, p] of ctx.previous.entries())
      lines.push(`- Part ${i + 1} · ${p.title}: ${await covers(p, summary)}`);
  } else lines.push('', 'This is the first part: it introduces the series.');
  const start = resolveStart(series, partId);
  lines.push(
    '',
    start.kind === 'part'
      ? `Where it starts: the dry runs and the recording open part ${start.number}'s project as its recording ended${start.part.project ? ` (built by projects/${start.part.project}/script.spec.ts)` : ''}. Export the same \`fixture\` as that script, so the product waits for the same project, and don't rebuild what earlier parts made: it's already there.`
      : ctx.number === 1
        ? 'Where it starts: its own fixture.'
        : 'Where it starts: its own fixture, a clean project. Anything earlier parts made that this part needs is rebuilt in setup, off camera.',
  );
  lines.push(
    '',
    ctx.next
      ? `Next: part ${ctx.number + 1} · ${ctx.next.title}${ctx.next.goal ? ` (${ctx.next.goal.trim()})` : ''}. End with one line that leads into it, without teaching it.`
      : 'This is the last part: close the series with a line on what the viewer can now build.',
  );
  if (series.notes.trim())
    lines.push('', 'Series notes (names, sample data and words every part uses):', '', series.notes.trim());
  return lines.join('\n');
}

/**
 * Keeps the "## Series" section of every part's CLAUDE.md up to date with its series: called
 * when the series changes and before a part's agent plans.
 */
export class SeriesContext {
  constructor(
    private deps: {
      projects: ProjectStore;
      series: SeriesStore;
      /** The summary of a project's saved plan, if it has one. */
      planSummary(project: string): Promise<string | null>;
    },
  ) {}

  private summary: PartSummary = async (part) => (part.project ? this.deps.planSummary(part.project) : null);

  /** Rewrites the section for every part that has a project. */
  async syncSeries(slug: string): Promise<void> {
    const series = await this.deps.series.get(slug);
    for (const part of series.parts)
      if (part.project) await this.write(part.project, await seriesSection(series, part.id, this.summary));
  }

  /** Rewrites the section of one project, if it belongs to a series. */
  async syncProject(project: string): Promise<void> {
    const { project: p } = await this.deps.projects.open(project);
    if (!p.series) return;
    const series = await this.deps.series.get(p.series.slug).catch(() => null);
    if (!series) return;
    await this.write(project, await seriesSection(series, p.series.part, this.summary));
  }

  /** Takes the section out (the project left its series). */
  async clear(project: string): Promise<void> {
    await this.write(project, '');
  }

  private async write(project: string, section: string) {
    const file = path.join(this.deps.projects.dir(project), 'CLAUDE.md');
    const md = await readFile(file, 'utf8').catch(() => null);
    if (md === null) return;
    const next = section ? setSections(md, { Series: section }) : removeSection(md, 'Series');
    if (next !== md) await writeFile(file, next);
  }
}

/** Removes a `## <name>` section and its body. */
export function removeSection(md: string, name: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of md.split('\n')) {
    if (/^## /.test(line)) skipping = line.slice(3).trim() === name;
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
