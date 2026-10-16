import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { formatIssues, Plan, PipelineStage } from '@studio/core';
import { fail, json, type ToolContext } from './context';

export function pipelineTools(ctx: ToolContext) {
  return [
    tool(
      'save_plan',
      'Save the tutorial plan for the storyboard review: a one-line summary, the steps (id s1, s2, …, a short imperative title, what happens on screen, draft narration), and optional proposed explainers ({after: step id or "start", idea}). Replaces the previous plan.',
      {
        summary: z.string().max(600).optional(),
        steps: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            action: z.string().optional(),
            narration: z.string().optional(),
          }),
        ),
        explainers: z.array(z.object({ after: z.string(), idea: z.string() })).optional(),
      },
      async (input) => {
        const parsed = Plan.safeParse(input);
        if (!parsed.success) return fail(`Invalid plan: ${formatIssues(parsed.error)}`);
        const plan = await ctx.pipeline.savePlan(ctx.slug, parsed.data);
        return json({ saved: true, steps: plan.steps.length, explainers: plan.explainers.length });
      },
    ),
    tool(
      'stage_done',
      'Tell the production pipeline you finished the stage it asked for (the stage named in its "[Pipeline · …]" message). Use ok: false when you are blocked, and explain why in the summary.',
      {
        stage: PipelineStage,
        summary: z.string().max(1000),
        ok: z.boolean().default(true),
        knowledge: z
          .string()
          .max(200)
          .optional()
          .describe(
            'If you changed a skill, one line saying what you learned (e.g. "http-service: Resource Path field renamed"). The pipeline commits skill changes with it.',
          ),
      },
      async ({ stage, summary, ok, knowledge }) => ({
        content: [{ type: 'text', text: ctx.pipeline.stageDone(ctx.slug, stage, ok, summary, knowledge) }],
      }),
    ),
  ];
}
