import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { RecorderEvent } from '@studio/core';
import { fail, json, type ToolContext } from './context';

/** Mouse paths are long; the agent needs where they went, not every point. */
function condense(e: RecorderEvent) {
  if (e.kind !== 'mouse') return e;
  const { points, ...rest } = e;
  return { ...rest, points: points.length, from: points[0], to: points.at(-1) };
}

export function projectTools(ctx: ToolContext) {
  const catalogTool = (kind: 'overlay' | 'scene') =>
    tool(
      kind === 'overlay' ? 'list_overlays' : 'list_scenes',
      kind === 'overlay'
        ? 'Overlay components this tutorial can use (core built-ins, the shared workspace library, and this project), with descriptions and a JSON Schema of their props. Reuse one before writing a new component.'
        : 'Explainer scene components available to this tutorial, with descriptions and prop schemas.',
      { query: z.string().optional().describe('Filter by words in the id, name or description') },
      async ({ query }) => {
        const { entries } = await ctx.catalog();
        const q = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
        return json(
          entries
            .filter((e) => e.kind === kind)
            .filter((e) => q.every((w) => `${e.id} ${e.name} ${e.description}`.toLowerCase().includes(w))),
        );
      },
      { annotations: { readOnlyHint: true } },
    );

  return [
    tool(
      'get_project',
      'The current tutorial project: slug, title, product, status, and a summary of its timeline (takes, steps, overlays).',
      {},
      async () => {
        const { project, timeline } = await ctx.store.open(ctx.slug);
        return json({
          project,
          timeline: {
            takes: timeline.takes.map((t) => t.id),
            steps: timeline.steps.map((s) => ({ id: s.id, title: s.title })),
            overlays: timeline.overlays.length,
            scenes: timeline.scenes.length,
          },
        });
      },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'get_events',
      'Recorder events of one step from its take (events.jsonl): clicks and typing with their target boxes in take pixels, key presses, and condensed mouse paths. Times are take seconds.',
      { stepId: z.string() },
      async ({ stepId }) => {
        const { timeline } = await ctx.timelines.get(ctx.slug);
        const step = timeline.steps.find((s) => s.id === stepId);
        if (!step) return fail(`No step "${stepId}". Steps: ${timeline.steps.map((s) => s.id).join(', ')}`);
        const take = timeline.takes.find((t) => t.id === step.take);
        if (!take) return fail(`Step "${stepId}" refers to missing take "${step.take}"`);
        const text = await readFile(path.join(ctx.store.dir(ctx.slug), take.events), 'utf8');
        const events = text
          .split('\n')
          .filter(Boolean)
          .map((l) => RecorderEvent.safeParse(JSON.parse(l)))
          .flatMap((r) => (r.success ? [r.data] : []));
        // Events between the step's own markers; fall back to its time range.
        const start = events.findIndex((e) => e.kind === 'step-start' && e.stepId === stepId);
        const end = events.findIndex((e) => e.kind === 'step-end' && e.stepId === stepId);
        const inStep =
          start >= 0
            ? events.slice(start, end >= 0 ? end + 1 : undefined)
            : events.filter((e) => e.t >= step.from && e.t <= step.to);
        return json({
          step: { id: step.id, title: step.title, take: take.id },
          events: inStep.map(condense),
        });
      },
      { annotations: { readOnlyHint: true } },
    ),
    catalogTool('overlay'),
    catalogTool('scene'),
  ];
}
