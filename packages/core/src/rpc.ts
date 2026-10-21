import { z } from 'zod';
import { Project, Rect, RecorderEvent, Take, Timeline } from './schemas';
import { TimelinePatch } from './patch';
import { AgentEvent, AgentStatus } from './agent';
import { PipelineGates, PipelineStage, PipelineState, PipelineStatus } from './pipeline';
import { ClaudeSignIn, ProductConfig, ProductInfo, SetupItem, StudioSettings } from './settings';
import { Pronunciation } from './pronounce';
import { Brief, PlanEdit } from './brief';
import { Run } from './runs';
import { ExplainerJob } from './explainers';
import { ExportPlan, ExportSettings, ExportState } from './export';

/** A component in the shared overlay library (`overlays/index.json`). */
export const LibraryEntry = z.object({
  id: z.string(),
  kind: z.enum(['overlay', 'scene']).default('overlay'),
  /** Scenes: the beat names it animates on. */
  beats: z.array(z.string()).optional(),
  name: z.string(),
  description: z.string(),
  props: z.array(z.string()),
  thumbnail: z.string().nullable(),
  from: z.string(),
  promotedAt: z.string(),
});

/**
 * The engine's WebSocket protocol.
 *   request  { id, method, params }
 *   reply    { id, result } | { id, error: { message, code } }
 *   event    { event, data }
 * Every method is declared here with zod schemas for params and result, so the engine
 * validates input and the UI gets typed calls.
 */
export const NewProject = z.object({
  title: z.string().min(1).max(120),
  product: z.string().min(1).default('wso2-integrator'),
  brief: Brief.partial().optional(),
});

/** A project card: metadata plus what the Projects screen shows and routes on. */
export const ProjectSummary = Project.extend({
  /** Output duration of the timeline in seconds, null before the first take. */
  duration: z.number().nullable(),
  /** Poster URL path on the engine (needs the token), null before the first take. */
  poster: z.string().nullable(),
  pipeline: z.object({ status: PipelineStatus, stage: PipelineStage.nullable() }),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

const ReferenceSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.url() }),
  /** A local file path (Tauri drag-and-drop gives paths). */
  z.object({ kind: z.literal('path'), path: z.string().min(1) }),
  /** File contents from a browser file input or drop (at most 5 MB). */
  z.object({ kind: z.literal('data'), name: z.string().min(1).max(200), base64: z.string().max(7_000_000) }),
]);

const TtsStatus = z.object({
  configured: z.boolean(),
  source: z.enum(['env', 'keychain', 'file']).nullable(),
});

export const SkillCoverage = z.object({
  product: z.string(),
  /** The product's skill folder, null when the workspace has none. */
  skill: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      lastVerified: z.string().nullable(),
      /** Shares words with the goal, so the plan will probably use it. */
      relevant: z.boolean(),
    }),
  ),
});
export type SkillCoverage = z.infer<typeof SkillCoverage>;

const WorkspaceStatus = z.object({
  path: z.string(),
  initialized: z.boolean(),
  head: z.string().nullable(),
  commits: z.number(),
});
const CommitInfo = z.object({ hash: z.string(), date: z.string(), subject: z.string() });

const TimelineState = z.object({
  version: z.number(),
  timeline: Timeline,
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});

/** A run or inspector streaming to Live. */
export const LiveSession = z.object({
  state: z.enum(['started', 'stopped']),
  title: z.string(),
  mode: z.enum(['dry', 'record']),
  frame: z.object({ width: z.number(), height: z.number() }).nullable(),
  /** The project it belongs to, when there is one. */
  slug: z.string().nullable().default(null),
});
export type LiveSession = z.infer<typeof LiveSession>;

export const SignInStatus = z.object({
  product: z.string(),
  /** A profile is saved (the sign-in window has been opened at least once). */
  saved: z.boolean(),
  updatedAt: z.number().nullable(),
  /** The sign-in window is open (launches wait for it to close). */
  open: z.boolean(),
});
export type SignInStatus = z.infer<typeof SignInStatus>;

export const rpcMethods = {
  ping: {
    params: z.object({ sentAt: z.number() }),
    result: z.object({ sentAt: z.number(), engineVersion: z.string(), workspace: z.string() }),
  },
  'project.list': {
    params: z.object({}),
    result: z.array(ProjectSummary),
  },
  'brief.get': { params: z.object({ slug: z.string() }), result: Brief },
  /** Saves the brief and renders it into the project's CLAUDE.md. Drafts also take their title from the goal. */
  'brief.save': { params: z.object({ slug: z.string(), brief: Brief }), result: Brief },
  'brief.addReference': { params: z.object({ slug: z.string(), source: ReferenceSource }), result: Brief },
  'brief.removeReference': {
    params: z.object({ slug: z.string(), index: z.number().int().min(0) }),
    result: Brief,
  },
  /** What the product skill already covers, and which notes look relevant to a goal. */
  'skills.coverage': {
    params: z.object({ product: z.string(), goal: z.string().max(2000).default('') }),
    result: SkillCoverage,
  },
  /** Whether ElevenLabs has a key (never the key itself). */
  'tts.status': { params: z.object({}), result: TtsStatus },
  /** Checks the key against ElevenLabs, then stores it (Keychain on macOS). */
  'tts.setKey': { params: z.object({ apiKey: z.string().min(1).max(200) }), result: TtsStatus },
  'tts.clearKey': { params: z.object({}), result: TtsStatus },
  'voices.list': {
    params: z.object({ refresh: z.boolean().default(false) }),
    result: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string().nullable(),
        description: z.string(),
        previewUrl: z.string().nullable(),
      }),
    ),
  },
  /** Synthesizes one line into the project's audio/ cache (returns per-character timings). */
  'tts.synthesize': {
    params: z.object({
      slug: z.string(),
      text: z.string().min(1).max(5000),
      voiceId: z.string().min(1),
      modelId: z.string().optional(),
    }),
    result: z.object({
      hash: z.string(),
      /** Project-relative path, served by /media. */
      audio: z.string(),
      duration: z.number(),
      cached: z.boolean(),
      alignment: z.object({
        chars: z.array(z.string()),
        starts: z.array(z.number()),
        ends: z.array(z.number()),
      }),
    }),
  },
  /** Voices each step's narration and writes the lines to the timeline (one undo step). */
  'vo.generate': {
    params: z.object({ slug: z.string(), stepIds: z.array(z.string()).optional() }),
    result: z.object({
      lines: z.array(z.object({ stepId: z.string(), duration: z.number(), cached: z.boolean() })),
      skipped: z.array(z.object({ stepId: z.string(), reason: z.string() })),
      seconds: z.number(),
      fit: z
        .object({ before: z.number(), after: z.number(), holds: z.number(), spedUp: z.number() })
        .optional(),
    }),
  },
  /** Rebuilds the automatic overlays (pointer, zooms, blurs, title) from the take's events; keeps the rest. */
  'overlays.auto': {
    params: z.object({ slug: z.string() }),
    result: TimelineState.extend({ count: z.number() }),
  },
  /** Inserts an explainer scene at output time `at` (splitting the recording there). */
  'scenes.insert': {
    params: z.object({
      slug: z.string(),
      at: z.number().min(0),
      component: z.string(),
      props: z.record(z.string(), z.unknown()).optional(),
      duration: z.number().positive().optional(),
      /** FreezeMorph in and out where the neighbours are the recording (default true). */
      transitions: z.boolean().optional(),
    }),
    result: TimelineState,
  },
  /** Explainers being made with the agent (storyboards waiting for review, builds). */
  'explainers.list': { params: z.object({ slug: z.string() }), result: z.array(ExplainerJob) },
  /** Inserts a placeholder explainer at `at` and asks the agent for a storyboard from `brief`. */
  'explainers.start': {
    params: z.object({ slug: z.string(), at: z.number().min(0), brief: z.string().min(3).max(400) }),
    result: ExplainerJob,
  },
  'explainers.editBeat': {
    params: z.object({
      slug: z.string(),
      sceneId: z.string(),
      beatId: z.string(),
      narration: z.string().min(1).max(300),
    }),
    result: ExplainerJob,
  },
  /** Approves a storyboard: the agent builds, voices and checks the scene. */
  'explainers.approve': { params: z.object({ slug: z.string(), sceneId: z.string() }), result: ExplainerJob },
  'explainers.revise': {
    params: z.object({ slug: z.string(), sceneId: z.string(), feedback: z.string().min(1).max(2000) }),
    result: ExplainerJob,
  },
  /** Removes the explainer scene and closes the job. */
  'explainers.cancel': { params: z.object({ slug: z.string(), sceneId: z.string() }), result: ExplainerJob },
  /** Removes an explainer scene; the recording around it joins up again. */
  'scenes.remove': { params: z.object({ slug: z.string(), sceneId: z.string() }), result: TimelineState },
  /** The shared overlay library's index (promoted components with props summaries and thumbnails). */
  'library.index': { params: z.object({}), result: z.array(LibraryEntry) },
  /** Moves project:Name into the shared library (it must pass check_overlay first). */
  'library.promote': {
    params: z.object({ slug: z.string(), id: z.string() }),
    result: LibraryEntry,
  },
  /** Agent runs that changed something, oldest first. */
  'runs.list': { params: z.object({ slug: z.string() }), result: z.array(Run) },
  /** One run with the unified diff of its files. */
  'runs.get': {
    params: z.object({ slug: z.string(), n: z.number().int() }),
    result: z.object({ run: Run, diff: z.string() }),
  },
  /** Accept: the run's annotations are resolved. */
  'runs.accept': { params: z.object({ slug: z.string(), n: z.number().int() }), result: Run },
  /** Reopen: the run's annotations go back to open (the changes stay). */
  'runs.reopen': { params: z.object({ slug: z.string(), n: z.number().int() }), result: Run },
  /** Revert: files and timeline go back to the snapshot before the run; annotations reopen. */
  'runs.revert': { params: z.object({ slug: z.string(), n: z.number().int() }), result: Run },
  /** Sends a follow-up about a run to the agent (a new run on the same annotations). */
  'runs.followUp': {
    params: z.object({ slug: z.string(), n: z.number().int(), text: z.string().min(1).max(4000) }),
    result: z.object({ queued: z.boolean() }),
  },
  /** Sends annotations (given ids, or every open one) to the agent as one turn with frames and context. */
  'annotations.send': {
    params: z.object({ slug: z.string(), ids: z.array(z.string()).optional() }),
    result: z.object({ sent: z.number(), images: z.number() }),
  },
  /** Rebuilds the caption cues from the voice-over (hand-edited cues stay). */
  'captions.build': { params: z.object({ slug: z.string() }), result: TimelineState },
  /** Fits the recording to the voice-over: freezes where the voice is longer, speeds up idle stretches (≤1.5×). */
  'timing.fit': {
    params: z.object({ slug: z.string() }),
    result: z.object({
      before: z.number(),
      after: z.number(),
      steps: z.array(
        z.object({
          stepId: z.string(),
          action: z.number(),
          needed: z.number(),
          hold: z.number(),
          speed: z.number(),
          overrun: z.number(),
        }),
      ),
    }),
  },
  /** Waveform peaks (0–1) of a project audio file, `rate` per second. */
  'vo.peaks': {
    params: z.object({ slug: z.string(), audio: z.string() }),
    result: z.object({ rate: z.number(), peaks: z.array(z.number()) }),
  },
  /** Products and the size of the knowledge base, for the Projects screen. */
  'knowledge.summary': {
    params: z.object({}),
    result: z.object({
      products: z.array(z.object({ id: z.string(), name: z.string(), skill: z.string().nullable() })),
      productSkills: z.number(),
      components: z.number(),
      overlays: z.number(),
      scenes: z.number(),
    }),
  },
  'project.create': {
    params: NewProject,
    result: Project,
  },
  /** Removes a project's folder and commits the removal (git history keeps a copy). */
  'project.delete': {
    params: z.object({ slug: z.string() }),
    result: z.object({ deleted: z.boolean(), commit: z.string().nullable() }),
  },
  'project.open': {
    params: z.object({ slug: z.string() }),
    result: z.object({ project: Project, timeline: Timeline }),
  },
  'workspace.status': { params: z.object({}), result: WorkspaceStatus },
  'workspace.init': { params: z.object({}), result: WorkspaceStatus },
  'workspace.tree': { params: z.object({}), result: z.array(z.string()) },
  'workspace.read': {
    params: z.object({ path: z.string().min(1) }),
    result: z.object({ path: z.string(), text: z.string() }),
  },
  'workspace.log': {
    params: z.object({ limit: z.number().int().min(1).max(200).default(20) }),
    result: z.array(CommitInfo),
  },
  'recorder.launchCheck': {
    params: z.object({ product: z.string().default('wso2-integrator') }),
    result: z.object({
      ok: z.boolean(),
      product: z.string(),
      vscodeVersion: z.string(),
      viewport: z.object({
        mode: z.enum(['fullscreen', 'window']),
        width: z.number(),
        height: z.number(),
        scale: z.number(),
      }),
      activityBar: z.array(z.string()),
      extensionEntry: z.string().nullable(),
      titleBar: z.string(),
      projectDetected: z.boolean(),
      dialogs: z.array(z.string()),
      screenshot: z.object({ width: z.number(), height: z.number(), dataUrl: z.string() }),
      durationMs: z.number(),
      problems: z.array(z.string()),
    }),
  },
  'recorder.runSample': {
    params: z.object({ mode: z.enum(['dry', 'record']), broken: z.boolean().default(false) }),
    result: z.object({
      passed: z.boolean(),
      mode: z.enum(['dry', 'record']),
      viewport: z.object({ mode: z.string(), width: z.number(), height: z.number(), scale: z.number() }),
      eventsFile: z.string(),
      events: z.array(RecorderEvent),
      targetFrames: z.array(
        z.object({ stepId: z.string(), target: z.string(), bbox: Rect, dataUrl: z.string() }),
      ),
      failure: z
        .object({
          stepId: z.string(),
          title: z.string(),
          error: z.string(),
          dataUrl: z.string(),
          ariaSnapshot: z.string(),
          webviewAriaSnapshot: z.string(),
        })
        .nullable(),
      durationMs: z.number(),
    }),
  },
  'recorder.recordSampleTake': {
    params: z.object({}),
    result: z.object({
      slug: z.string(),
      /** Path of the take folder under the project, e.g. recordings/take-3. */
      takePath: z.string(),
      take: Take,
      codec: z.string(),
      frames: z.number(),
      events: z.array(RecorderEvent),
    }),
  },
  'project.record': {
    params: z.object({ slug: z.string(), mode: z.enum(['dry', 'record']) }),
    result: z.object({
      passed: z.boolean(),
      slug: z.string(),
      takePath: z.string().nullable(),
      take: Take.nullable(),
      codec: z.string().nullable(),
      steps: z.array(
        z.object({ id: z.string(), title: z.string(), start: z.number(), end: z.number().nullable() }),
      ),
      failure: z
        .object({ stepId: z.string(), title: z.string(), error: z.string(), dataUrl: z.string() })
        .nullable(),
      durationMs: z.number(),
    }),
  },
  'recorder.stop': { params: z.object({}), result: z.object({ stopping: z.boolean() }) },
  'overlays.info': { params: z.object({}), result: z.object({ url: z.string() }) },
  'overlays.list': {
    params: z.object({ slug: z.string().optional() }),
    result: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['overlay', 'scene']),
        scope: z.enum(['workspace', 'project']),
        path: z.string(),
        mtime: z.number(),
      }),
    ),
  },
  'overlays.writeSample': {
    params: z.object({ slug: z.string() }),
    result: z.object({ id: z.string(), path: z.string(), absolutePath: z.string() }),
  },
  /** One commit's message and diff (for the Knowledge panel). */
  'workspace.show': {
    params: z.object({ hash: z.string().regex(/^[0-9a-f]{4,40}$/) }),
    result: z.object({ hash: z.string(), subject: z.string(), date: z.string(), diff: z.string() }),
  },
  'workspace.openInEditor': {
    params: z.object({ path: z.string() }),
    result: z.object({ opened: z.boolean() }),
  },
  'timeline.get': { params: z.object({ slug: z.string() }), result: TimelineState },
  'timeline.patch': {
    params: z.object({
      slug: z.string(),
      patch: z.unknown(),
      author: z.enum(['user', 'agent', 'auto']).default('user'),
      /** Patches with the same group (one drag, one agent run) undo as one step. */
      group: z.string().nullable().default(null),
      label: z.string().optional(),
    }),
    result: TimelineState,
  },
  'timeline.undo': { params: z.object({ slug: z.string() }), result: TimelineState },
  /** Re-derives scenes and steps from the latest take (keeps overlays). */
  'timeline.rebuildFromTake': { params: z.object({ slug: z.string() }), result: TimelineState },
  'timeline.redo': { params: z.object({ slug: z.string() }), result: TimelineState },
  /** The project's agent session and its recent conversation (for a window opened later). */
  'agent.status': {
    params: z.object({ slug: z.string(), history: z.number().int().min(0).max(1000).default(200) }),
    result: z.object({ status: AgentStatus, history: z.array(AgentEvent) }),
  },
  /** Queues a message into the session, starting or resuming it if needed. */
  'agent.send': {
    params: z.object({ slug: z.string(), text: z.string().min(1).max(20000) }),
    result: z.object({ queued: z.boolean() }),
  },
  /** Stops the current turn (Pause). The session stays alive for the next message. */
  'agent.interrupt': {
    params: z.object({ slug: z.string() }),
    result: z.object({ interrupted: z.boolean() }),
  },
  /** Ends the session and forgets its id, so the next message starts a fresh conversation. */
  'agent.reset': { params: z.object({ slug: z.string() }), result: AgentStatus },
  'pipeline.get': { params: z.object({ slug: z.string() }), result: PipelineState },
  /** Starts (or restarts) the pipeline from the brief in the project's CLAUDE.md. */
  'pipeline.start': {
    params: z.object({ slug: z.string(), gates: PipelineGates.partial().optional() }),
    result: PipelineState,
  },
  /** Approves the waiting gate; the pipeline continues. */
  'pipeline.approve': { params: z.object({ slug: z.string() }), result: PipelineState },
  /** Sends feedback for the waiting gate; the agent revises and the gate opens again. */
  'pipeline.revise': {
    params: z.object({ slug: z.string(), feedback: z.string().min(1).max(4000) }),
    result: PipelineState,
  },
  'pipeline.stop': { params: z.object({ slug: z.string() }), result: PipelineState },
  /** Edits the plan in place during the storyboard review (narration, titles, explainer ideas). */
  'pipeline.editPlan': {
    params: z.object({ slug: z.string(), edits: z.array(PlanEdit).min(1).max(50) }),
    result: PipelineState,
  },
  /** Starts exporting the tutorial into `output/` (progress arrives as `export.progress`). */
  'export.start': {
    params: z.object({ slug: z.string(), settings: ExportSettings.default(ExportSettings.parse({})) }),
    result: ExportState,
  },
  /** What an export with these settings would produce, for the Export screen. */
  'export.plan': {
    params: z.object({ slug: z.string(), settings: ExportSettings.default(ExportSettings.parse({})) }),
    result: ExportPlan,
  },
  'export.cancel': { params: z.object({ slug: z.string() }), result: z.object({ cancelled: z.boolean() }) },
  /** The project's current or last export this session. */
  'export.status': { params: z.object({ slug: z.string() }), result: ExportState.nullable() },
  /** Studio-wide defaults, plus where the workspace is and whether this is the packaged app. */
  'settings.get': {
    params: z.object({}),
    result: StudioSettings.extend({ workspace: z.string(), packaged: z.boolean() }),
  },
  'settings.update': {
    params: StudioSettings.partial(),
    result: StudioSettings.extend({ workspace: z.string(), packaged: z.boolean() }),
  },
  /** The products the recorder can launch (built-in ones merged with products.json). */
  'products.list': { params: z.object({}), result: z.array(ProductInfo) },
  /** Replaces the entries of products.json (built-in products can't be removed) and commits. */
  'products.save': { params: z.object({ products: z.array(ProductConfig) }), result: z.array(ProductInfo) },
  /** How product terms are spoken in voice-overs (the workspace's pronunciations.json). */
  'pronunciations.get': { params: z.object({}), result: z.array(Pronunciation) },
  /** Replaces pronunciations.json and commits it. */
  'pronunciations.save': {
    params: z.object({ pronunciations: z.array(Pronunciation) }),
    result: z.array(Pronunciation),
  },
  /** The first-run checklist (the Claude sign-in is checked on request: see agent.signInStatus). */
  'setup.status': { params: z.object({}), result: z.array(SetupItem) },
  /** Runs `claude auth status` the way the agent would: only when the user asks. */
  'agent.signInStatus': { params: z.object({}), result: ClaudeSignIn },
  /** The run streaming to Live right now, if any (screens show a Live chip). */
  'live.status': { params: z.object({}), result: z.object({ session: LiveSession.nullable() }) },
  /** The product's saved sign-in profile (recordings start signed in from a copy of it). */
  'product.signInStatus': { params: z.object({ product: z.string() }), result: SignInStatus },
  /** Opens the product on its sign-in profile so the user can sign in, then quit it. */
  'product.signIn': { params: z.object({ product: z.string() }), result: SignInStatus },
  /** Forgets the sign-in profile: launches start signed out again. */
  'product.signOut': { params: z.object({ product: z.string() }), result: SignInStatus },
  /** Shows a file of the project in Finder. */
  'project.reveal': {
    params: z.object({ slug: z.string(), path: z.string() }),
    result: z.object({ ok: z.boolean() }),
  },
  /** Answers a tool permission request raised by `canUseTool`. */
  'agent.permission': {
    params: z.object({
      slug: z.string(),
      requestId: z.string(),
      allow: z.boolean(),
      message: z.string().optional(),
    }),
    result: z.object({ resolved: z.boolean() }),
  },
} as const;

export type RpcMethod = keyof typeof rpcMethods;
export type RpcParams<M extends RpcMethod> = z.input<(typeof rpcMethods)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.output<(typeof rpcMethods)[M]['result']>;

export const rpcEvents = {
  'project.changed': z.object({ slug: z.string() }),
  /** A sign-in window opened or closed. */
  'product.signInChanged': SignInStatus,
  'workspace.changed': z.object({ head: z.string().nullable() }),
  'recorder.progress': z.object({ message: z.string(), at: z.number() }),
  'recorder.event': RecorderEvent,
  'timeline.changed': z.object({
    slug: z.string(),
    version: z.number(),
    patch: TimelinePatch,
    author: z.enum(['user', 'agent', 'auto']),
    kind: z.enum(['patch', 'undo', 'redo']),
    canUndo: z.boolean(),
    canRedo: z.boolean(),
  }),
  'overlays.changed': z.object({
    id: z.string().nullable(),
    path: z.string(),
    event: z.enum(['add', 'change', 'unlink']),
    version: z.number(),
  }),
  'live.frame': z.object({ data: z.string(), width: z.number(), height: z.number(), timestamp: z.number() }),
  'live.action': z.object({
    stepId: z.string(),
    kind: z.enum(['click', 'type']),
    label: z.string(),
    bbox: Rect,
  }),
  /** The recorder's pointer in frame pixels, streamed while it moves (the video has no cursor). */
  'live.pointer': z.object({ x: z.number(), y: z.number(), click: z.boolean() }),
  'live.stage': z.object({
    stage: z.enum(['fixture', 'launch', 'load', 'run', 'encode', 'done', 'failed', 'stopped']),
    at: z.number(),
  }),
  'agent.event': AgentEvent,
  'runs.changed': z.object({ slug: z.string() }),
  'explainers.changed': z.object({ slug: z.string() }),
  'agent.state': AgentStatus,
  'export.progress': ExportState,
  /** The newest rendered frame of a running export (a small JPEG, a few per second). */
  'export.frame': z.object({ slug: z.string(), index: z.number(), data: z.string() }),
  'pipeline.changed': PipelineState,
  'live.session': LiveSession,
} as const;
export type RpcEvent = keyof typeof rpcEvents;
export type RpcEventData<E extends RpcEvent> = z.output<(typeof rpcEvents)[E]>;

export const RpcRequest = z.object({ id: z.number().int(), method: z.string(), params: z.unknown() });
export type RpcRequest = z.infer<typeof RpcRequest>;

export interface RpcErrorBody {
  message: string;
  code: 'bad_request' | 'not_found' | 'unknown_method' | 'internal';
}

export type RpcReply = { id: number; result: unknown } | { id: number; error: RpcErrorBody };
export type RpcEventMessage = { event: string; data: unknown };

export class RpcError extends Error {
  override name = 'RpcError';
  constructor(
    message: string,
    readonly code: RpcErrorBody['code'] = 'internal',
  ) {
    super(message);
  }
}

/** Header (HTTP) or query parameter (WebSocket, media URLs) carrying the session token. */
export const TOKEN_HEADER = 'x-studio-token';
export const TOKEN_QUERY = 'token';

// ---------------------------------------------------------------------------
// Client (works in the browser and in Node with the `ws` package)
// ---------------------------------------------------------------------------

interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
type SocketCtor = new (url: string) => SocketLike;

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface EngineClient {
  readonly url: string;
  state(): ConnectionState;
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  on<E extends RpcEvent>(event: E, fn: (data: RpcEventData<E>) => void): () => void;
  onState(fn: (s: ConnectionState) => void): () => void;
  close(): void;
}

export interface ClientOptions {
  /** e.g. ws://127.0.0.1:4317/rpc */
  url: string;
  token: string;
  WebSocket?: SocketCtor;
  /** Reconnect delay in ms; 0 disables reconnecting. */
  reconnectMs?: number;
}

export function createEngineClient(opts: ClientOptions): EngineClient {
  const Ctor: SocketCtor = opts.WebSocket ?? (globalThis as unknown as { WebSocket: SocketCtor }).WebSocket;
  const url = `${opts.url}?${TOKEN_QUERY}=${encodeURIComponent(opts.token)}`;
  const reconnectMs = opts.reconnectMs ?? 1000;
  let socket: SocketLike;
  let state: ConnectionState = 'connecting';
  let closedByUser = false;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const queue: string[] = [];
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  const stateListeners = new Set<(s: ConnectionState) => void>();

  const setState = (s: ConnectionState) => {
    state = s;
    stateListeners.forEach((fn) => fn(s));
  };

  function connect() {
    setState('connecting');
    socket = new Ctor(url);
    socket.onopen = () => {
      setState('open');
      while (queue.length) socket.send(queue.shift()!);
    };
    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as RpcReply | RpcEventMessage;
      if ('event' in msg) {
        listeners.get(msg.event)?.forEach((fn) => fn(msg.data));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if ('error' in msg) p.reject(new RpcError(msg.error.message, msg.error.code));
      else p.resolve(msg.result);
    };
    socket.onclose = () => {
      setState('closed');
      for (const p of pending.values()) p.reject(new RpcError('connection closed'));
      pending.clear();
      if (!closedByUser && reconnectMs > 0) setTimeout(connect, reconnectMs);
    };
    socket.onerror = () => {
      /* onclose follows and handles it */
    };
  }
  connect();

  return {
    url: opts.url,
    state: () => state,
    call(method, params) {
      const id = nextId++;
      const text = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        if (state === 'open') socket.send(text);
        else queue.push(text);
      });
    },
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(fn as (d: unknown) => void);
      return () => set.delete(fn as (d: unknown) => void);
    },
    onState(fn) {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    close() {
      closedByUser = true;
      socket.close();
    },
  };
}
