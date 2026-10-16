import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ProjectStore } from '../projects';

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

/**
 * The in-process `studio` MCP server a project's session talks to. Its tools run in the
 * engine, so they read and change the tutorial through the same stores as the UI.
 * Timeline, recorder and overlay tools arrive in steps 3.2 and 3.3.
 */
export function studioServer(slug: string, deps: { store: ProjectStore }): Record<string, McpServerConfig> {
  const server = createSdkMcpServer({
    name: 'studio',
    version: '0.1.0',
    instructions:
      'Tutorial Studio tools for the current tutorial project. Use them to read and change the tutorial instead of editing tutorial.json by hand.',
    tools: [
      tool(
        'get_project',
        'The current tutorial project: slug, title, product, status, and a summary of its timeline (takes, steps, overlays).',
        {},
        async () => {
          const { project, timeline } = await deps.store.open(slug);
          return json({
            project,
            timeline: {
              takes: timeline.takes.map((t) => t.id),
              steps: timeline.steps.map((s) => ({ id: s.id, title: s.title })),
              overlays: timeline.overlays.length,
              scenes: timeline.scenes.length,
            },
          });
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
  return { studio: server };
}
