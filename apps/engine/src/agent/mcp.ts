import { createSdkMcpServer, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ToolContext } from './tools/context';
import { frameTools } from './tools/frames';
import { projectTools } from './tools/project';
import { timelineTools } from './tools/timeline';
import { runScriptTools } from './tools/runScript';
import { inspectTools } from './tools/inspectUi';
import { pipelineTools } from './tools/pipeline';
import { voTools } from './tools/vo';
import { checkOverlayTools } from './tools/checkOverlay';
import { explainerTools } from './tools/insertExplainer';
import { docTools } from './tools/doc';

/**
 * The in-process `studio` MCP server a project's session talks to. Its tools run in the
 * engine, so they read and change the tutorial through the same stores as the UI.
 */
export function studioServer(ctx: ToolContext): Record<string, McpServerConfig> {
  const server = createSdkMcpServer({
    name: 'studio',
    version: '0.2.0',
    instructions:
      'Tutorial Studio tools for the current tutorial project. Read the tutorial with get_timeline, list_steps and capture_frame; change it only with apply_timeline_patch (never edit tutorial.json directly). Run and debug script.spec.ts with run_script and inspect_ui. Voice the narration with generate_voiceover. After writing an overlay component, verify it with check_overlay. Explain a concept with insert_explainer (storyboard first), set_explainer and check_scene.',
    tools: [
      ...projectTools(ctx),
      ...timelineTools(ctx),
      ...frameTools(ctx),
      ...runScriptTools(ctx),
      ...inspectTools(ctx),
      ...pipelineTools(ctx),
      ...voTools(ctx),
      ...checkOverlayTools(ctx),
      ...explainerTools(ctx),
      ...docTools(ctx),
    ],
  });
  return { studio: server };
}
