import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { cap, fail, type ToolContext } from './context';
import { imageBlock } from './frames';

export function inspectTools(ctx: ToolContext) {
  return [
    tool(
      'inspect_ui',
      [
        'Research the live WSO2 Integrator UI, e.g. after run_script fails because the UI changed.',
        "Opens the product on the script's fixture and keeps it open between calls (closed after 5 idle",
        'minutes or by run_script). uptoStep replays the script up to (not including) that step id, or "all";',
        'it reopens the window. actions are Playwright statements run with page, webview() (the active',
        "webview's content frame) and tut in scope, e.g. \"await webview().getByRole('button', { name:",
        '\'Add Resource\' }).click();". probes are locator expressions to test, e.g. "webview().getByRole(',
        "'textbox', { name: 'Resource Path' })\"; each returns its match count, visibility, text and box (frame",
        'pixels). Returns probe results, ARIA snapshots and a screenshot. Prefer role and label locators.',
      ].join(' '),
      {
        uptoStep: z.string().optional(),
        restart: z.boolean().optional().describe('Reopen the product on a fresh fixture'),
        actions: z.string().optional(),
        probes: z.array(z.string()).max(30).optional(),
        snapshot: z.enum(['both', 'window', 'webview', 'none']).default('both'),
        screenshot: z.boolean().default(true),
        close: z.boolean().optional().describe('Close the product window when done'),
      },
      async (args): Promise<CallToolResult> => {
        let opened;
        try {
          opened = await ctx.runner.inspect(ctx.slug, {
            ...(args.uptoStep ? { uptoStep: args.uptoStep } : {}),
            ...(args.restart ? { restart: true } : {}),
          });
        } catch (e) {
          return fail(`Could not open the product: ${e instanceof Error ? e.message : String(e)}`);
        }
        const { inspector, fresh } = opened;
        const report: Record<string, unknown> = { reopened: fresh };
        if (fresh && args.uptoStep) {
          report.completedSteps = inspector.completedSteps;
          if (inspector.failure)
            report.replayFailed = {
              stepId: inspector.failure.stepId,
              error: inspector.failure.error,
              errorDetail: inspector.failure.errorDetail,
            };
        }
        if (args.actions) report.actions = await inspector.run(args.actions);
        if (args.probes?.length) report.probes = await inspector.probe(args.probes);
        const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(report, null, 2) }];
        if (args.snapshot !== 'none' || args.screenshot) {
          const snap = await inspector.snapshot();
          if (args.snapshot === 'both' || args.snapshot === 'window')
            content.push({ type: 'text', text: `Window ARIA snapshot:\n${cap(snap.ariaSnapshot)}` });
          if ((args.snapshot === 'both' || args.snapshot === 'webview') && snap.webviewAriaSnapshot)
            content.push({ type: 'text', text: `Webview ARIA snapshot:\n${cap(snap.webviewAriaSnapshot)}` });
          if (args.screenshot) content.push(await imageBlock(snap.screenshot));
        }
        if (args.close) await ctx.runner.closeInspector();
        return content.length ? { content } : fail('nothing to report');
      },
    ),
  ];
}
