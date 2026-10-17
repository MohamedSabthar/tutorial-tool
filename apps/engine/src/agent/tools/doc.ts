import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { fail, json, type ToolContext } from './context';

export function docTools(ctx: ToolContext) {
  return [
    tool(
      'save_doc_instructions',
      "Save the written instructions for the Markdown version of the tutorial (one per step, rewritten from the step's narration). Export asks for these with a message listing the steps; call this once with all of them.",
      {
        steps: z
          .array(z.object({ stepId: z.string(), instruction: z.string().min(1).max(600) }))
          .min(1)
          .max(100),
      },
      async ({ steps }) => {
        try {
          return json(await ctx.docs.save(ctx.slug, steps));
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    ),
  ];
}
