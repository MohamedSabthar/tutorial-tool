import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { fail, json, type ToolContext } from './context';

export function voTools(ctx: ToolContext) {
  return [
    tool(
      'generate_voiceover',
      "Synthesize the voice-over from each step's narration with the voice chosen in the brief, and put the lines on the timeline (one per step, starting just after the step begins). Pass stepIds to redo only some steps, e.g. after editing their narration. Returns each line's length, so you can compare it with the step's on-screen time.",
      { stepIds: z.array(z.string()).optional() },
      async ({ stepIds }) => {
        try {
          const r = await ctx.voiceover.generate(ctx.slug, {
            ...(stepIds ? { stepIds } : {}),
            author: 'agent',
            group: ctx.runId(),
          });
          return json(r);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    ),
  ];
}
