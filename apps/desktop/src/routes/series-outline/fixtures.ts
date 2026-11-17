import { Series, type PartStatus, type ProjectSummary } from '@studio/core';

/*
 * Dev-only sample data for `#/series/<slug>?preview=drafting|review|approved`: states that can't be
 * reached safely in testing (the agent drafting, an outline waiting, episodes being made).
 */

export type OutlinePreview = 'drafting' | 'review' | 'approved' | 'empty';

const PARTS = [
  {
    id: 'p1',
    title: 'Create your first AI agent',
    goal: 'Make a chat agent service and give it a math tutor role.',
    objectives: ['Add a chat agent service', 'Write a system prompt'],
  },
  {
    id: 'p2',
    title: 'Give the agent tools',
    goal: 'Add sum, subtract, multiply and divide as custom tools.',
    objectives: ['Add a tool', 'Describe it for the model'],
  },
  {
    id: 'p3',
    title: 'Trace and test the tutor',
    goal: 'Turn on tracing, run the service and ask it questions in Agent Chat.',
    objectives: ['Turn on tracing', 'Read a trace'],
  },
  {
    id: 'p4',
    title: 'Handle bad questions',
    goal: 'Add guardrails so the tutor declines questions that are not math.',
    objectives: ['Add a guardrail'],
  },
];

export function previewSeries(slug: string, state: OutlinePreview): Series {
  const now = new Date().toISOString();
  const started = new Date(Date.now() - 38_000).toISOString();
  const approved = state === 'approved';
  return Series.parse({
    slug,
    title: 'Build an AI math tutor',
    topic: 'Build an AI math tutor: create the agent, give it tools, then trace and test it',
    product: 'wso2-integrator',
    outline:
      state === 'drafting' ? 'planning' : state === 'empty' ? 'draft' : approved ? 'approved' : 'review',
    parts:
      state === 'drafting'
        ? PARTS.slice(0, 2)
        : state === 'empty'
          ? []
          : PARTS.map((p, i) => ({ ...p, project: approved ? `preview-ep-${i + 1}` : null })),
    createdAt: started,
    updatedAt: state === 'drafting' ? started : now,
  });
}

/** Episodes in every state, for the approved preview. */
export function previewProjects(): ProjectSummary[] {
  const at = new Date().toISOString();
  const base = { product: 'wso2-integrator', createdAt: at, updatedAt: at, poster: null, capturing: false };
  const pipe = (
    status: ProjectSummary['pipeline']['status'],
    stage: ProjectSummary['pipeline']['stage'] = null,
  ) => ({
    status,
    stage,
  });
  return [
    {
      ...base,
      slug: 'preview-ep-1',
      title: 'Create your first AI agent',
      status: 'edit',
      duration: 200,
      pipeline: pipe('done'),
    },
    {
      ...base,
      slug: 'preview-ep-2',
      title: 'Give the agent tools',
      status: 'draft',
      duration: null,
      pipeline: pipe('waiting', 'narrate'),
    },
    {
      ...base,
      slug: 'preview-ep-3',
      title: 'Trace and test the tutor',
      status: 'draft',
      duration: null,
      pipeline: pipe('idle'),
    },
    {
      ...base,
      slug: 'preview-ep-4',
      title: 'Handle bad questions',
      status: 'draft',
      duration: null,
      pipeline: pipe('idle'),
    },
  ].map((p) => ({ ...p, series: undefined })) as ProjectSummary[];
}

export function previewStarts(): PartStatus[] {
  return [
    { part: 'p1', start: 'clean', recordedAt: new Date().toISOString(), blocked: false, stale: false },
    { part: 'p2', start: 'p1', recordedAt: null, blocked: false, stale: false },
    { part: 'p3', start: 'p2', recordedAt: null, blocked: true, stale: false },
    { part: 'p4', start: 'p3', recordedAt: null, blocked: true, stale: false },
  ];
}

export const PREVIEW_ACTIVITY = 'Splitting the journey into episodes';
