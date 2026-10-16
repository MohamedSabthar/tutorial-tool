import { createSdkMcpServer, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ToolContext } from './tools/context';
import { frameTools } from './tools/frames';
import { projectTools } from './tools/project';
import { timelineTools } from './tools/timeline';

/**
 * The in-process `studio` MCP server a project's session talks to. Its tools run in the
 * engine, so they read and change the tutorial through the same stores as the UI.
 * Recorder tools (`run_script`, `inspect_ui`) arrive in step 3.3.
 */
export function studioServer(ctx: ToolContext): Record<string, McpServerConfig> {
  const server = createSdkMcpServer({
    name: 'studio',
    version: '0.2.0',
    instructions:
      'Tutorial Studio tools for the current tutorial project. Read the tutorial with get_timeline, list_steps and capture_frame; change it only with apply_timeline_patch (never edit tutorial.json directly).',
    tools: [...projectTools(ctx), ...timelineTools(ctx), ...frameTools(ctx)],
  });
  return { studio: server };
}
