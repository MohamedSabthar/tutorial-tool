import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { fail, type ToolContext } from './context';

export function checkOverlayTools(ctx: ToolContext) {
  return [
    tool(
      'check_overlay',
      'Check an overlay component you wrote: type-check, determinism lint, bundle, then render it composited in the tutorial (recording, camera, other overlays) at its start, 25/50/75%, end and just after, render one moment twice to confirm it is deterministic, and return the problems plus a contact sheet image. Run it after every change to a component, and fix what it reports. file is relative to the project (e.g. "overlays/StepBadge.tsx") or the workspace ("overlays/…" for shared components).',
      {
        file: z.string().min(1),
        times: z.array(z.number().min(0)).max(9).optional(),
        instanceId: z.string().optional(),
      },
      async ({ file, times, instanceId }) => {
        try {
          const r = await ctx.checkOverlay(file, {
            ...(times ? { times } : {}),
            ...(instanceId ? { instanceId } : {}),
          });
          const lines = [
            r.ok
              ? `✓ ${r.component} passed every check.`
              : `✗ ${r.component}: ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}.`,
            ...r.problems.map((p) => `- [${p.stage}]${p.line ? ` line ${p.line}` : ''} ${p.message}`),
            r.instance
              ? `Rendered ${r.instance.test ? 'a temporary test instance' : `instance ${r.instance.id}`} (${r.instance.start.toFixed(2)}–${r.instance.end.toFixed(2)} s) at: ${r.frames.map((f) => `${f.label} ${f.t.toFixed(2)} s`).join(', ')}. The contact sheet shows them left to right, top to bottom.`
              : 'Nothing was rendered.',
          ];
          return {
            content: [
              { type: 'text' as const, text: lines.join('\n') },
              ...(r.sheet
                ? [{ type: 'image' as const, data: r.sheet.toString('base64'), mimeType: 'image/jpeg' }]
                : []),
            ],
            ...(r.ok ? {} : { isError: false }),
          };
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    ),
  ];
}
