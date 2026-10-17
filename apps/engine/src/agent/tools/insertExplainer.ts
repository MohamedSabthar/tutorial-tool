import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Beat, StoryboardBeat } from '@studio/core';
import { fail, json, type ToolContext } from './context';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function explainerTools(ctx: ToolContext) {
  return [
    tool(
      'insert_explainer',
      'Insert an animated explainer scene at output time `at` (seconds of the final video; a step boundary reads best). Splits the recording there, adds a placeholder with FreezeMorph transitions, and returns what to do next: write a storyboard for the user to approve before building it. Use it when the user asks to explain a concept, or for explainers proposed in the plan.',
      { at: z.number().min(0), brief: z.string().min(3).max(400) },
      async ({ at, brief }) => {
        try {
          const job = await ctx.explainers.start(ctx.slug, at, brief, false);
          return {
            content: [
              { type: 'text' as const, text: await ctx.explainers.storyboardInstruction(ctx.slug, job) },
            ],
          };
        } catch (e) {
          return fail(msg(e));
        }
      },
    ),
    tool(
      'save_storyboard',
      "Save an explainer's storyboard for the user's review: a title, the approach (which scene component and why), and 3–6 beats, each with an id (a lowercase word), one spoken narration line and what is shown. The narration lines and beats go onto the scene.",
      {
        sceneId: z.string(),
        title: z.string(),
        approach: z.string().optional(),
        beats: z.array(z.object({ id: z.string(), narration: z.string(), visual: z.string().optional() })),
      },
      async ({ sceneId, ...storyboard }) => {
        try {
          const beats = z.array(StoryboardBeat).parse(storyboard.beats);
          const job = await ctx.explainers.saveStoryboard(ctx.slug, sceneId, { ...storyboard, beats });
          return json({
            saved: true,
            beats: job.storyboard?.beats.map((b) => b.id),
            next: 'set_explainer to a rough draft, then check_scene, then end your turn',
          });
        } catch (e) {
          return fail(msg(e));
        }
      },
    ),
    tool(
      'set_explainer',
      'Set an explainer scene\'s component (a scene from list_scenes: core:DiagramFlow, core:ConceptCards, core:CodeWalkthrough, core:ArchitectureZoom, or one in scenes/), its props (validated against the component), its narration lines and optionally beats ([{id, at}] with at = "vo:N", "word:x" or seconds; by default the component\'s beats fall on narration lines 0, 1, 2…).',
      {
        sceneId: z.string(),
        component: z.string().optional(),
        props: z.record(z.string(), z.unknown()).optional(),
        narration: z.array(z.string()).optional(),
        beats: z.array(Beat).optional(),
      },
      async ({ sceneId, ...input }) => {
        try {
          const text = await ctx.explainers.setScene(ctx.slug, sceneId, {
            ...(input.component ? { component: input.component } : {}),
            ...(input.props ? { props: input.props } : {}),
            ...(input.narration ? { narration: input.narration } : {}),
            ...(input.beats ? { beats: input.beats } : {}),
          });
          return { content: [{ type: 'text' as const, text }] };
        } catch (e) {
          return fail(msg(e));
        }
      },
    ),
    tool(
      'check_scene',
      'Check an explainer scene: code checks for its component file, frames rendered in the tutorial just after each beat (plus start and end) as a contact sheet, a determinism re-render, and how the beats line up with the narration (or voice-over). Run it after every change to the scene; during the storyboard its frames become the review cards.',
      { sceneId: z.string() },
      async ({ sceneId }) => {
        try {
          const r = await ctx.checkScene(sceneId);
          await ctx.explainers.attachFrames(ctx.slug, sceneId, r.frames);
          const lines = [
            r.ok
              ? `✓ ${r.component} in ${r.sceneId} passed every check.`
              : `✗ ${r.component} in ${r.sceneId}: ${r.problems.length} problem(s) and/or alignment warnings.`,
            ...r.problems.map((p) => `- [${p.stage}]${p.line ? ` line ${p.line}` : ''} ${p.message}`),
            `Beats (${r.voiced ? 'from the voice-over' : 'estimated from the narration text'}):`,
            ...r.alignment.map((a) => `  ${a}`),
            `Frames (scene runs ${r.span.start.toFixed(2)}–${r.span.end.toFixed(2)} s): ${r.frames.map((f) => `${f.label} ${(f.t - r.span.start).toFixed(2)} s`).join(', ')}. The contact sheet shows them left to right, top to bottom.`,
          ];
          return {
            content: [
              { type: 'text' as const, text: lines.join('\n') },
              ...(r.sheet
                ? [{ type: 'image' as const, data: r.sheet.toString('base64'), mimeType: 'image/jpeg' }]
                : []),
            ],
          };
        } catch (e) {
          return fail(msg(e));
        }
      },
    ),
    tool(
      'explainer_done',
      'Tell the Studio an explainer is finished (built, voiced, checked). The summary is shown to the user.',
      { sceneId: z.string(), summary: z.string().max(600) },
      async ({ sceneId, summary }) => {
        try {
          await ctx.explainers.done(ctx.slug, sceneId, summary);
          return { content: [{ type: 'text' as const, text: 'Recorded. Finish your turn.' }] };
        } catch (e) {
          return fail(msg(e));
        }
      },
    ),
  ];
}
