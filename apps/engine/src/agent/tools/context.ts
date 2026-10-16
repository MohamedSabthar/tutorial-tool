import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectStore } from '../../projects';
import type { TimelineStore } from '../../timeline';
import type { Catalog } from '../catalog';

/** What the studio tools of one project can reach. */
export interface ToolContext {
  slug: string;
  store: ProjectStore;
  timelines: TimelineStore;
  catalog(): Promise<Catalog>;
  /** Undo group of the agent's current turn: its patches undo as one step. */
  runId(): string;
}

export const json = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

export const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });

export const round = (n: number) => Math.round(n * 1000) / 1000;
