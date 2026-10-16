import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { stepTimings } from '../../recording';
import { cap, fail, round, type ToolContext } from './context';
import { imageBlock } from './frames';

export function runScriptTools(ctx: ToolContext) {
  return [
    tool(
      'run_script',
      [
        "Run this project's script.spec.ts in WSO2 Integrator on a fresh copy of its fixture; the user watches",
        'it live. mode "dry" checks the script quickly without recording; "record" records a new take and',
        'registers it in the timeline (steps and the recording scene are rebuilt; overlays are kept).',
        'Always pass a dry run before recording. On failure you get the failing step, the error with',
        "Playwright's call log, a screenshot, and ARIA snapshots of the window and the active webview.",
      ].join(' '),
      { mode: z.enum(['dry', 'record']) },
      async ({ mode }): Promise<CallToolResult> => {
        let r;
        try {
          r = await ctx.runner.runProject(ctx.slug, mode);
        } catch (e) {
          return fail(`The run could not start or crashed: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (r.take) ctx.onTake();
        const steps = stepTimings(r.events).map((s) => ({
          id: s.id,
          title: s.title,
          seconds: s.end === null ? null : round(s.end - s.start),
        }));
        const passedSteps = steps.filter((s) => s.seconds !== null).length;
        if (r.passed)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    passed: true,
                    mode,
                    summary: `${passedSteps}/${steps.length} steps passed`,
                    steps,
                    take: r.take ? { id: r.take.id, duration: r.take.duration, path: r.takePath } : null,
                    durationMs: r.durationMs,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        const f = r.failure!;
        const content: CallToolResult['content'] = [
          {
            type: 'text',
            text: JSON.stringify(
              {
                passed: false,
                mode,
                summary: `failed at ${f.stepId} after ${passedSteps} passing step${passedSteps === 1 ? '' : 's'}`,
                stepId: f.stepId,
                title: f.title,
                error: f.error,
                errorDetail: f.errorDetail,
                steps,
              },
              null,
              2,
            ),
          },
        ];
        if (f.screenshot.length) content.push(await imageBlock(f.screenshot));
        if (f.ariaSnapshot)
          content.push({ type: 'text', text: `Window ARIA snapshot:\n${cap(f.ariaSnapshot)}` });
        if (f.webviewAriaSnapshot)
          content.push({ type: 'text', text: `Webview ARIA snapshot:\n${cap(f.webviewAriaSnapshot)}` });
        return { content, isError: true };
      },
    ),
  ];
}
