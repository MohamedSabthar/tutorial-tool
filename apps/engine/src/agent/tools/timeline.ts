import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  applyPatch,
  buildTimeMap,
  formatIssues,
  PatchError,
  TimelineError,
  TimelinePatch,
  voiceSpans,
  type OverlayInstance,
  type Timeline,
} from '@studio/core';
import { cutsOf } from '../../timing';
import { fail, json, round, type ToolContext } from './context';

const overlaps = (start: number, end: number, from?: number, to?: number) =>
  (from === undefined || end > from) && (to === undefined || start < to);

/** Output-time span of each step (first time its take range is shown). */
export function stepSpans(tl: Timeline) {
  const map = buildTimeMap(tl);
  return tl.steps.map((s) => {
    const start = map.toOutput(s.take, s.from)[0];
    const end = map.toOutput(s.take, s.to)[0] ?? (start !== undefined ? start + (s.to - s.from) : undefined);
    return {
      step: s,
      start: start === undefined ? null : round(start),
      end: end === undefined ? null : round(end),
    };
  });
}

/** A compact view of the timeline: what the agent needs to plan a patch, with array indexes for paths. */
export function summarize(tl: Timeline, version: number, from?: number, to?: number) {
  const map = buildTimeMap(tl);
  return {
    version,
    duration: round(map.duration),
    size: tl.size,
    fps: tl.fps,
    takes: tl.takes.map((t) => ({ id: t.id, duration: t.duration, width: t.width, height: t.height })),
    scenes: map.scenes.map((s) => ({
      id: s.sceneId,
      kind: s.kind,
      start: round(s.start),
      end: round(s.end),
    })),
    steps: stepSpans(tl)
      .filter((s) => s.start === null || overlaps(s.start, s.end ?? s.start, from, to))
      .map(({ step, start, end }) => ({
        id: step.id,
        title: step.title,
        start,
        end,
        hasTarget: !!step.bbox,
        narration: step.narration || undefined,
      })),
    overlays: tl.overlays
      .map((o, index) => ({ index, ...o }))
      .filter((o) => overlaps(o.start, o.end, from, to)),
    // Recording pieces (speed, freezes) and cuts, so edits can be planned in output time.
    pieces: map.segments
      .filter((g) => overlaps(g.start, g.end, from, to))
      .map((g) => ({
        start: round(g.start),
        end: round(g.end),
        kind: g.segment.kind,
        ...(g.segment.kind === 'speed' ? { rate: g.segment.rate } : {}),
        ...(g.segment.manual ? { manual: true } : {}),
      })),
    cuts: cutsOf(tl)
      .filter((c) => overlaps(c.at, c.at, from, to) || (from === undefined && to === undefined))
      .map((c) => ({ at: c.at, removed: round(c.to - c.from) })),
    captions: tl.captions.filter((c) => overlaps(c.start, c.end, from, to)).length,
    voiceLines: voiceSpans(tl, map)
      .filter((v) => overlaps(v.start, v.end, from, to))
      .map((v) => ({
        id: v.line.id,
        owner: v.line.owner,
        start: round(v.start),
        end: round(v.end),
        text: v.line.text.length > 80 ? `${v.line.text.slice(0, 80)}…` : v.line.text,
        ...(v.line.manual ? { manual: true } : {}),
      })),
    openAnnotations: tl.annotations.filter((a) => a.status !== 'resolved').length,
  };
}

const PatchInput = z
  .array(
    z.object({
      op: z.enum(['add', 'remove', 'replace', 'move', 'test']),
      path: z.string().describe('JSON pointer, e.g. "/overlays/-" to append or "/overlays/2/props/title"'),
      from: z.string().optional().describe('Source pointer for "move"'),
      value: z.unknown().optional(),
    }),
  )
  .min(1);

/** Marks overlays the agent adds as agent-authored, unless it set an author itself. */
function tagAuthor(patch: z.infer<typeof PatchInput>) {
  return patch.map((op) =>
    op.op === 'add' &&
    /^\/overlays\/(\d+|-)$/.test(op.path) &&
    op.value &&
    typeof op.value === 'object' &&
    !('author' in op.value)
      ? { ...op, value: { ...(op.value as object), author: 'agent' } }
      : op,
  );
}

/** Checks every added or changed overlay against its component: it must exist and its props must parse. */
export async function checkOverlays(before: Timeline, after: Timeline, ctx: ToolContext): Promise<string[]> {
  const prev = new Map(before.overlays.map((o) => [o.id, JSON.stringify(o)]));
  const changed = after.overlays.filter((o) => prev.get(o.id) !== JSON.stringify(o));
  if (!changed.length) return [];
  const catalog = await ctx.catalog();
  const known = new Map(catalog.entries.map((e) => [e.id, e]));
  const problems: string[] = [];
  const stepIds = new Set(after.steps.map((s) => s.id));
  for (const o of changed as OverlayInstance[]) {
    const entry = known.get(o.component);
    if (!entry) {
      problems.push(
        `overlay "${o.id}": unknown component "${o.component}". Available: ${catalog.entries
          .filter((e) => e.kind === 'overlay')
          .map((e) => e.id)
          .join(', ')}`,
      );
      continue;
    }
    if (entry.error) {
      problems.push(`overlay "${o.id}": component ${o.component} does not load: ${entry.error}`);
      continue;
    }
    const schema = catalog.schemas.get(o.component);
    const parsed = schema?.safeParse(o.props);
    if (parsed && !parsed.success)
      problems.push(`overlay "${o.id}" props for ${o.component}: ${formatIssues(parsed.error)}`);
    if (o.anchor && !stepIds.has(o.anchor.stepId))
      problems.push(`overlay "${o.id}": anchor step "${o.anchor.stepId}" does not exist`);
  }
  return problems;
}

export function timelineTools(ctx: ToolContext) {
  return [
    tool(
      'get_timeline',
      [
        'Read the tutorial timeline (tutorial.json). Times are output seconds of the final video.',
        'detail "summary" (default) returns takes, scenes, steps with their output spans, and overlays with',
        'their array index (use it in patch paths). Pass from/to to limit steps and overlays to a time range.',
        'detail "full" returns the whole timeline document.',
      ].join(' '),
      {
        detail: z.enum(['summary', 'full']).default('summary'),
        from: z.number().optional(),
        to: z.number().optional(),
      },
      async ({ detail, from, to }) => {
        const { timeline, version, canUndo } = await ctx.timelines.get(ctx.slug);
        if (detail === 'full') return json({ version, canUndo, timeline });
        return json({ canUndo, ...summarize(timeline, version, from, to) });
      },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'apply_timeline_patch',
      [
        'Change the timeline with a JSON Patch (RFC 6902 subset: add, remove, replace, move, test).',
        'This is the only way to change the tutorial; never edit tutorial.json directly.',
        'Overlay instances look like {"id":"ov_title","component":"core:TitleCard","start":0,"end":3,',
        '"layer":10,"props":{...}} with optional "anchor":{"stepId":"s2"} (follows the step target) or',
        '"rect":{"x","y","w","h"} in take pixels. Use list_overlays for components and their props.',
        'All of your patches in one turn undo as a single step for the user.',
        'On error nothing changes and the message says what to fix.',
      ].join(' '),
      {
        patch: PatchInput,
        label: z.string().max(80).optional().describe('Short undo label, e.g. "Add title card"'),
      },
      async ({ patch, label }) => {
        const ops = tagAuthor(patch);
        const parsed = TimelinePatch.safeParse(ops);
        if (!parsed.success) return fail(`Invalid patch: ${formatIssues(parsed.error)}`);
        const { timeline: before } = await ctx.timelines.get(ctx.slug);
        let after: Timeline;
        try {
          after = applyPatch(before, parsed.data);
        } catch (e) {
          if (e instanceof PatchError || e instanceof TimelineError)
            return fail(`Patch rejected: ${e.message}`);
          throw e;
        }
        const problems = await checkOverlays(before, after, ctx);
        if (problems.length) return fail(`Patch rejected:\n- ${problems.join('\n- ')}`);
        try {
          const r = await ctx.timelines.patch(ctx.slug, parsed.data, {
            author: 'agent',
            group: ctx.runId(),
            label: label ?? 'Agent edit',
          });
          return json({ ok: true, version: r.version, overlays: r.timeline.overlays.length });
        } catch (e) {
          return fail(`Patch rejected: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    ),
    tool(
      'list_steps',
      'The recorded steps in order: id, title, output start/end seconds, take range, narration and the primary target box (take pixels) that anchored overlays follow.',
      {},
      async () => {
        const { timeline } = await ctx.timelines.get(ctx.slug);
        return json(
          stepSpans(timeline).map(({ step, start, end }) => ({
            id: step.id,
            title: step.title,
            start,
            end,
            take: step.take,
            takeRange: [step.from, step.to],
            narration: step.narration,
            target: step.bbox ?? null,
          })),
        );
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];
}
