import type { AgentEvent, AgentStatus, Run, Timeline } from '@studio/core';

/**
 * Dev-only fixtures for states that can't be reached safely (`#/studio/<slug>?preview=<state>`):
 * the agent working, waiting for approval or done, a save in progress, and a tutorial with no
 * recording yet. Every preview edits an in-memory copy of the timeline, never the workspace.
 */
export const PREVIEWS = ['edit', 'agent-working', 'agent-approval', 'agent-result', 'saving', 'empty'] as const;
export type Preview = (typeof PREVIEWS)[number];

export function previewFromHash(hash: string): Preview | null {
  if (!import.meta.env.DEV) return null;
  const v = new URLSearchParams(hash.split('?')[1] ?? '').get('preview');
  return PREVIEWS.includes(v as Preview) ? (v as Preview) : null;
}

const base = (slug: string, seq: number, at: number) => ({ slug, seq, at });

export function previewAgent(
  preview: Preview,
  slug: string,
  timeline: Timeline | null,
): { status: AgentStatus; events: AgentEvent[]; run: Run | null } | null {
  const now = Date.now();
  const step = timeline?.steps[2] ?? timeline?.steps[0];
  const status = (state: AgentStatus['state'], pending: string[] = []): AgentStatus => ({
    slug,
    state,
    sessionId: 'preview',
    model: 'preview',
    costUsd: 0.42,
    pending,
  });
  const prompt: AgentEvent = {
    ...base(slug, 1, now - 14_000),
    kind: 'user',
    text: 'Add an arrow at Create in step 3',
    source: 'user',
  };
  if (preview === 'agent-working')
    return {
      status: status('busy'),
      events: [
        prompt,
        { ...base(slug, 2, now - 12_000), kind: 'tool_use', id: 't1', name: 'mcp__studio__get_timeline', summary: '', input: {} },
        { ...base(slug, 3, now - 11_000), kind: 'tool_result', id: 't1', isError: false, text: '', images: 0 },
        { ...base(slug, 4, now - 9_000), kind: 'tool_use', id: 't2', name: 'mcp__studio__render_frame', summary: 'step 3', input: { stepId: step?.id } },
        { ...base(slug, 5, now - 7_000), kind: 'tool_result', id: 't2', isError: false, text: '', images: 1 },
        {
          ...base(slug, 6, now - 3_000),
          kind: 'tool_use',
          id: 't3',
          name: 'mcp__studio__add_overlay',
          summary: 'core:Arrow',
          input: { component: 'core:Arrow', anchor: { stepId: step?.id, target: 'primary' } },
        },
      ],
      run: null,
    };
  if (preview === 'agent-approval')
    return {
      status: status('busy', ['perm-1']),
      events: [
        { ...prompt, text: 'Record step 3 again' },
        {
          ...base(slug, 2, now - 2_000),
          kind: 'permission',
          requestId: 'perm-1',
          tool: 'mcp__studio__record_steps',
          summary: `${step?.title ?? 'step 3'}`,
          input: { stepIds: [step?.id] },
          reason: 'Opens WSO2 Integrator and records this step again (about 40 s). Your edits to other steps stay.',
        },
      ],
      run: null,
    };
  if (preview === 'agent-result')
    return {
      status: status('idle'),
      events: [prompt, { ...base(slug, 9, now - 1_000), kind: 'result', ok: true, subtype: 'success', turns: 6, durationMs: 21_000, costUsd: 0.42, text: 'Done.' }],
      run: {
        n: 7,
        runId: 'run-preview',
        startedAt: now - 22_000,
        endedAt: now - 1_000,
        prompt: 'Add an arrow at Create in step 3',
        annotationIds: [],
        before: 'abc1234',
        after: 'def5678',
        summary:
          'Added an arrow pointing at Create\nShows for 5 s in step 3, as the narrator mentions it. It follows the button if the screen moves.',
        costUsd: 0.42,
        durationMs: 21_000,
        checks: ['✓ core:Arrow renders at 24.0 s'],
        files: [{ path: 'tutorial.json', added: 12, removed: 0 }],
        timeline: ['Added overlay arrow-preview (core:Arrow) 24.0–29.0 s'],
        status: 'review',
        frames: {},
      },
    };
  return null;
}
