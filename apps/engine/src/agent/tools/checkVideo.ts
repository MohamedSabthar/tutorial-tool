import { tool } from '@anthropic-ai/claude-agent-sdk';
import { fail, type ToolContext } from './context';

export function checkVideoTools(ctx: ToolContext) {
  return [
    tool(
      'check_video',
      'Final QA of the tutorial as it will be exported. It reports what can be found from the timeline and the take (voice running into the next step, clicks off their words, dialogs or notifications left on screen, captions too long or too short, overlays failing to render), and returns contact sheets of composited frames at the start and end of every step and at every click and key press. Look at every frame: an overlay covering what is clicked, captions over the important part of the screen, error dialogs, secrets or machine paths that need a Blur, a zoom that cuts off the target.',
      {},
      async () => {
        try {
          const r = await ctx.checkVideo();
          const text = [
            r.issues.length
              ? `${r.issues.length} problem${r.issues.length === 1 ? '' : 's'} found from the timeline and the take:`
              : 'Nothing found from the timeline and the take.',
            ...r.issues.map((i) => `- ${i}`),
            `${r.frames.length} frames rendered, in ${r.sheets.length} contact sheet${r.sheets.length === 1 ? '' : 's'} (left to right, top to bottom): ${r.frames.map((f) => f.label).join(' · ')}`,
          ].join('\n');
          return {
            content: [
              { type: 'text' as const, text },
              ...r.sheets.map((s) => ({
                type: 'image' as const,
                data: s.toString('base64'),
                mimeType: 'image/jpeg',
              })),
            ],
          };
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    ),
  ];
}
