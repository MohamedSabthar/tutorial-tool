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
          if (r.fitError)
            return fail(
              `The voice lines are saved, but the timing fit after them failed, so picture and voice are out of sync: ${r.fitError}\n` +
                "Don't report the voice-over as done. Fix the cause if the error says what to change, run generate_voiceover again, or tell the user what failed.",
            );
          return json(r);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    ),
  ];
}
