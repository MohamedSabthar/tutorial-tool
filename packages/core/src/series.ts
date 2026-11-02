import { z } from 'zod';
import { Brief } from './brief';

/**
 * A tutorial series: an ordered list of parts that share a brief. Each part becomes its own
 * project once the outline is approved. Saved as `workspace/series/<slug>/series.json`.
 */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Brief fields every part inherits (each part keeps its own goal and references). */
export const SeriesBrief = Brief.pick({
  audience: true,
  length: true,
  style: true,
  voice: true,
  explainers: true,
  autoMode: true,
  gates: true,
});
export type SeriesBrief = z.infer<typeof SeriesBrief>;

export const SeriesPart = z.object({
  /** Stable id (p1, p2, …): order is the array order, never the id. */
  id: z.string().regex(/^p\d{1,3}$/),
  title: z.string().min(1).max(120),
  goal: z.string().max(2000).default(''),
  /** What a viewer can do after this part, one per line item. */
  objectives: z.array(z.string().min(1).max(200)).max(10).default([]),
  /** The part's project once the outline is approved. */
  project: z.string().regex(SLUG_RE).nullable().default(null),
});
export type SeriesPart = z.infer<typeof SeriesPart>;

export const Series = z.object({
  slug: z.string().regex(SLUG_RE),
  title: z.string().min(1).max(120),
  /** What the user typed: what the series is about. */
  topic: z.string().max(2000).default(''),
  product: z.string().min(1),
  brief: SeriesBrief.default(SeriesBrief.parse({})),
  /** Notes for the whole series: sample names, conventions, glossary. Every part's agent reads them. */
  notes: z.string().max(4000).default(''),
  parts: z.array(SeriesPart).max(20).default([]),
  /**
   * Where the outline is: written by hand or not yet planned (`draft`), the agent is writing it
   * (`planning`), waiting for the user (`review`), or approved (each part has a project).
   */
  outline: z.enum(['draft', 'planning', 'review', 'approved']).default('draft'),
  /** Why the last planning run didn't save an outline. */
  planError: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Series = z.infer<typeof Series>;

/** The next free part id (p1, p2, …). */
export function nextPartId(parts: readonly { id: string }[]): string {
  const used = parts.map((p) => Number(p.id.slice(1))).filter(Number.isFinite);
  return `p${(used.length ? Math.max(...used) : 0) + 1}`;
}

/** A part's place in its series: 1-based number, total, and its neighbours. */
export function partContext(series: Series, partId: string) {
  const index = series.parts.findIndex((p) => p.id === partId);
  if (index < 0) return null;
  return {
    number: index + 1,
    total: series.parts.length,
    part: series.parts[index]!,
    previous: series.parts.slice(0, index),
    prev: series.parts[index - 1] ?? null,
    next: series.parts[index + 1] ?? null,
  };
}

/** Edits the Series screen sends (validated like timeline patches). */
export const SeriesEdit = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('meta'),
    title: z.string().min(1).max(120).optional(),
    topic: z.string().max(2000).optional(),
    notes: z.string().max(4000).optional(),
    brief: SeriesBrief.partial().optional(),
  }),
  z.object({
    op: z.literal('addPart'),
    title: z.string().min(1).max(120),
    goal: z.string().max(2000).default(''),
  }),
  z.object({
    op: z.literal('editPart'),
    id: z.string(),
    title: z.string().min(1).max(120).optional(),
    goal: z.string().max(2000).optional(),
    objectives: z.array(z.string().min(1).max(200)).max(10).optional(),
  }),
  z.object({ op: z.literal('movePart'), id: z.string(), to: z.number().int().min(0) }),
  z.object({ op: z.literal('removePart'), id: z.string() }),
]);
export type SeriesEdit = z.input<typeof SeriesEdit>;

/** Applies an edit, returning a new series (throws on an unknown part). */
export function applySeriesEdit(series: Series, edit: SeriesEdit): Series {
  const e = SeriesEdit.parse(edit);
  const find = (id: string) => {
    const i = series.parts.findIndex((p) => p.id === id);
    if (i < 0) throw new Error(`no part "${id}"`);
    return i;
  };
  switch (e.op) {
    case 'meta':
      return Series.parse({
        ...series,
        ...(e.title !== undefined ? { title: e.title } : {}),
        ...(e.topic !== undefined ? { topic: e.topic } : {}),
        ...(e.notes !== undefined ? { notes: e.notes } : {}),
        brief: { ...series.brief, ...e.brief },
      });
    case 'addPart': {
      if (series.parts.length >= 20) throw new Error('a series has at most 20 parts');
      const part = SeriesPart.parse({ id: nextPartId(series.parts), title: e.title, goal: e.goal });
      return { ...series, parts: [...series.parts, part] };
    }
    case 'editPart': {
      const i = find(e.id);
      const parts = [...series.parts];
      const fields = {
        ...(e.title !== undefined ? { title: e.title } : {}),
        ...(e.goal !== undefined ? { goal: e.goal } : {}),
        ...(e.objectives !== undefined ? { objectives: e.objectives } : {}),
      };
      parts[i] = SeriesPart.parse({ ...parts[i], ...fields });
      return { ...series, parts };
    }
    case 'movePart': {
      const i = find(e.id);
      const parts = [...series.parts];
      const [part] = parts.splice(i, 1);
      parts.splice(Math.min(e.to, parts.length), 0, part!);
      return { ...series, parts };
    }
    case 'removePart': {
      const i = find(e.id);
      if (series.parts[i]!.project)
        throw new Error('this part already has a project: delete the project first');
      return { ...series, parts: series.parts.filter((_, j) => j !== i) };
    }
  }
}

/** The outline the agent saves (`save_series_plan`): it replaces the parts that have no project yet. */
export const SeriesPlan = z.object({
  title: z.string().min(1).max(120).optional(),
  notes: z.string().max(4000).optional(),
  parts: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        goal: z.string().min(1).max(2000),
        objectives: z.array(z.string().min(1).max(200)).min(1).max(6),
      }),
    )
    .min(2)
    .max(12),
});
export type SeriesPlan = z.infer<typeof SeriesPlan>;

/** Puts a saved plan into the series: new part ids, title and notes when given. */
export function applySeriesPlan(series: Series, plan: SeriesPlan): Series {
  if (series.parts.some((p) => p.project))
    throw new Error('the outline is approved: its parts already have tutorials');
  const parts: SeriesPart[] = [];
  for (const p of plan.parts)
    parts.push(
      SeriesPart.parse({ id: nextPartId(parts), title: p.title, goal: p.goal, objectives: p.objectives }),
    );
  return Series.parse({
    ...series,
    ...(plan.title ? { title: plan.title } : {}),
    ...(plan.notes !== undefined ? { notes: plan.notes } : {}),
    parts,
  });
}

/** The brief goal of a part's tutorial: its goal and what viewers can do after it. */
export function partGoal(part: SeriesPart): string {
  const goal = part.goal.trim() || part.title;
  return part.objectives.length ? `${goal}\n\nBy the end, viewers can: ${part.objectives.join('; ')}.` : goal;
}
