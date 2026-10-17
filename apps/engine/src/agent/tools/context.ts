import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectStore } from '../../projects';
import type { TimelineStore } from '../../timeline';
import type { Catalog } from '../catalog';
import type { Runner } from '../../runner';
import type { PipelineManager } from '../../pipeline/machine';
import type { Voiceover } from '../../vo';

/** What the studio tools of one project can reach. */
export interface ToolContext {
  slug: string;
  store: ProjectStore;
  timelines: TimelineStore;
  catalog(): Promise<Catalog>;
  runner: Runner;
  pipeline: Pick<PipelineManager, 'savePlan' | 'stageDone'>;
  voiceover: Pick<Voiceover, 'generate'>;
  /** Called after a run registered a new take (reload the timeline everywhere). */
  onTake(): void;
  /** Undo group of the agent's current turn: its patches undo as one step. */
  runId(): string;
}

export const json = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

export const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });

export const round = (n: number) => Math.round(n * 1000) / 1000;

/** Long snapshots are cut so one tool result stays a reasonable size. */
export const cap = (s: string, n = 12000) =>
  s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s;
