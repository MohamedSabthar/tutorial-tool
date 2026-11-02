import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fillCardText, partContext, Project, Series, type SeriesPart } from '@studio/core';
import type { AutoOptions } from './autoOverlays';

/**
 * How a series shows in a part's outputs: the title and end cards, the recap narration and the
 * docs links. Everything is read from disk next to the project (`<workspace>/projects/<slug>`),
 * so callers only need the project folder.
 */

export interface PartOfSeries {
  series: Series;
  part: SeriesPart;
  ctx: NonNullable<ReturnType<typeof partContext>>;
  workspace: string;
}

/** The series a project belongs to, or null. */
export async function seriesOf(projectDir: string): Promise<PartOfSeries | null> {
  try {
    const project = Project.parse(JSON.parse(await readFile(path.join(projectDir, 'project.json'), 'utf8')));
    if (!project.series) return null;
    const workspace = path.resolve(projectDir, '..', '..');
    const file = path.join(workspace, 'series', project.series.slug, 'series.json');
    const series = Series.parse(JSON.parse(await readFile(file, 'utf8')));
    const ctx = partContext(series, project.series.part);
    return ctx ? { series, part: ctx.part, ctx, workspace } : null;
  } catch {
    return null;
  }
}

/** The automatic title card (with the part number) and end card (the next part) for a project. */
export async function cardOptions(projectDir: string, title: string): Promise<AutoOptions> {
  const s = await seriesOf(projectDir);
  if (!s) return { title };
  const { outputs } = s.series;
  const { number, total, next } = s.ctx;
  const vars = { total, series: s.series.title, ...(next ? { next: next.title } : {}) };
  return {
    title,
    subtitle: s.series.title,
    ...(outputs.titleCard ? { eyebrow: fillCardText(outputs.titleText, { ...vars, n: number }) } : {}),
    ...(outputs.endCard && next
      ? {
          endCard: {
            eyebrow: fillCardText(outputs.endText, { ...vars, n: number + 1 }),
            title: next.title,
            subtitle: s.series.title,
          },
        }
      : {}),
  };
}

/** Whether the narration should recap earlier parts and lead into the next one. */
export async function recapNarration(projectDir: string): Promise<boolean> {
  return (await seriesOf(projectDir))?.series.outputs.recap ?? false;
}

const doc = (slug: string) => `../../${slug}/output/tutorial.md`;

/** The series lines of a part's tutorial.md (null outside a series). */
export async function docSeries(projectDir: string) {
  const s = await seriesOf(projectDir);
  if (!s) return null;
  const { number, total, prev, next } = s.ctx;
  const link = (p: SeriesPart | null, n: number) =>
    p?.project && s.series.outputs.links
      ? { title: `Part ${n}: ${p.title}`, href: doc(p.project) }
      : undefined;
  const prevLink = link(prev, number - 1);
  const nextLink = link(next, number + 1);
  return {
    part: `Part ${number} of ${total}`,
    series: s.series.title,
    ...(s.series.outputs.index ? { index: `../../../series/${s.series.slug}/README.md` } : {}),
    ...(prevLink ? { prev: prevLink } : {}),
    ...(nextLink ? { next: nextLink } : {}),
  };
}

/** `series/<slug>/README.md`: every part in order, linked to its doc and video once exported. */
export function seriesIndex(
  series: Series,
  exported: (project: string) => { doc: boolean; video: string | null },
) {
  const out = [`# ${series.title}`, ''];
  if (series.topic.trim() && series.topic.trim() !== series.title) out.push(series.topic.trim(), '');
  out.push(`${series.parts.length} parts. Each one builds on the one before it.`, '');
  series.parts.forEach((p, i) => {
    const files = p.project ? exported(p.project) : { doc: false, video: null };
    const title = files.doc ? `[${p.title}](../../projects/${p.project}/output/tutorial.md)` : p.title;
    out.push(
      `${i + 1}. ${title}${files.video ? ` · [video](../../projects/${p.project}/output/${files.video})` : ''}`,
    );
    if (p.goal.trim()) out.push(`   ${p.goal.trim().split('\n')[0]}`);
  });
  out.push('');
  return out.join('\n');
}

/** Writes the series index next to series.json, if the series wants one. */
export async function writeSeriesIndex(projectDir: string): Promise<string | null> {
  const s = await seriesOf(projectDir);
  if (!s || !s.series.outputs.index) return null;
  const projects = path.join(s.workspace, 'projects');
  const md = seriesIndex(s.series, (slug) => ({
    doc: existsSync(path.join(projects, slug, 'output', 'tutorial.md')),
    video: existsSync(path.join(projects, slug, 'output', `${slug}.mp4`)) ? `${slug}.mp4` : null,
  }));
  const file = path.join(s.workspace, 'series', s.series.slug, 'README.md');
  await writeFile(file, md);
  return `series/${s.series.slug}/README.md`;
}
