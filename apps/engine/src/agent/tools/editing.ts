import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { fail, json, type ToolContext } from './context';

const seconds = z.number().nonnegative();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Hand-editing tools for when the user asks for a specific change: speed up, cut or freeze part
 * of the recording, and write, move or delete voice lines. Times are output seconds, as
 * get_timeline reports them. What these tools change is marked as hand-made, so the timing fit
 * and voice-over regeneration keep it.
 */
export function editingTools(ctx: ToolContext) {
  const opts = () => ({ author: 'agent' as const, group: ctx.runId() });
  return [
    tool(
      'edit_recording',
      'Change how the recording plays between two output times (seconds, from get_timeline): "speed" plays it at `rate` (0.25–16; above 4 only for static screens), "normal" plays it as recorded, "remove" cuts it from the video (off camera), "auto" hands it back to the timing fit. Pieces are split at both times. Overlays, captions and annotations follow. Use it when the user asks for a cut or speed change; leave routine timing to the fit.',
      {
        from: seconds,
        to: seconds,
        action: z.enum(['speed', 'normal', 'remove', 'auto']),
        rate: z.number().min(0.25).max(16).optional(),
      },
      async ({ from, to, action, rate }) => {
        if (action === 'speed' && rate === undefined) return fail('Give a rate for "speed", e.g. 2.');
        const edit =
          action === 'remove'
            ? ({ op: 'remove' } as const)
            : action === 'auto'
              ? ({ op: 'auto' } as const)
              : ({ op: 'speed', rate: action === 'normal' ? 1 : rate! } as const);
        try {
          return json(await ctx.edits.editRange(ctx.slug, { from, to, edit }, opts()));
        } catch (e) {
          return fail(message(e));
        }
      },
    ),
    tool(
      'freeze_frame',
      'Freeze the frame shown at output time `at` for `seconds` (e.g. to give a line time to finish over a screen).',
      { at: seconds, seconds: z.number().positive().max(60) },
      async (p) => {
        try {
          await ctx.edits.freezeAt(ctx.slug, p, opts());
          return json({ ok: true });
        } catch (e) {
          return fail(message(e));
        }
      },
    ),
    tool(
      'restore_cut',
      'Put back recording that was cut out, at the output time of the cut (get_timeline lists cuts with their time).',
      { at: seconds },
      async (p) => {
        try {
          await ctx.edits.restoreCutAt(ctx.slug, p, opts());
          return json({ ok: true });
        } catch (e) {
          return fail(message(e));
        }
      },
    ),
    tool(
      'add_voice_line',
      "Voice a line written by hand (the project's voice and pronunciations) and place it at output time `at`, under the step showing there. Use it to narrate a stretch the step's line doesn't cover, or when the user dictates a line. Regenerating the voice-over keeps it. Returns the line with its id and length.",
      { text: z.string().min(1).max(600), at: seconds },
      async (p) => {
        try {
          return json(await ctx.voiceover.addLine(ctx.slug, p, { author: 'agent' }));
        } catch (e) {
          return fail(message(e));
        }
      },
    ),
    tool(
      'edit_voice_line',
      'Rewrite a voice line (voiced again) and/or move it to start at output time `at`. Ids come from get_timeline. The line becomes hand-made, so regenerating the voice-over keeps it.',
      { id: z.string(), text: z.string().min(1).max(600).optional(), at: seconds.optional() },
      async (p) => {
        if (p.text === undefined && p.at === undefined) return fail('Give new text, a new time, or both.');
        try {
          return json(await ctx.voiceover.editLine(ctx.slug, p, { author: 'agent' }));
        } catch (e) {
          return fail(message(e));
        }
      },
    ),
    tool(
      'remove_voice_line',
      'Delete a voice line by id (from get_timeline).',
      { id: z.string() },
      async (p) => {
        try {
          await ctx.voiceover.removeLine(ctx.slug, p, { author: 'agent' });
          return json({ ok: true });
        } catch (e) {
          return fail(message(e));
        }
      },
    ),
  ];
}
