import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  RpcError,
  RpcRequest,
  rpcMethods,
  TOKEN_HEADER,
  TOKEN_QUERY,
  type RpcEvent,
  type RpcEventData,
  type ProductConfig,
  type StudioSettings,
  type Brief,
  type PlanEdit,
  type RpcMethod,
  type RpcParams,
  type RpcReply,
  type RpcResult,
  formatIssues,
  RecorderEvent,
  withTake,
  insertExplainerScene,
  outputRemapper,
  remapOutputItems,
  removeExplainerScene,
  type Timeline,
  type ExportSettings,
} from '@studio/core';
import { ProjectStore } from './projects';
import { registerMedia } from './media';
import { isUiPath, registerUi, resolveUiUrl } from './ui';
import { Workspace } from './workspace';
import { Runner } from './runner';
import { stepTimings } from './recording';
import { startOverlayServer, type OverlayServer } from './overlayServer';
import { HELLO_OVERLAY } from './overlayTemplates';
import { TimelineStore, type Author } from './timeline';
import { AgentManager } from './agent/session';
import { studioServer } from './agent/mcp';
import { loadCatalog } from './agent/catalog';
import { PipelineManager } from './pipeline/machine';
import { WorkspaceGit } from './workspaceGit';
import { knowledgeSummary, skillCoverage } from './brief';
import { projectCard } from './cards';
import { secretStore } from './secrets';
import { TtsService } from './tts';
import { Voiceover } from './vo';
import { readEvents, TimingFit } from './timing';
import { clearPace, voicePace } from './pace';
import { withAutoOverlays } from './autoOverlays';
import { withCaptions } from './captions';
import { annotationMessage } from './agent/annotationContext';
import { HeadlessStage } from './render';
import { Exporter } from './export';
import { DocWriter } from './docs';
import { beforeBrowserLaunch, RenderHost } from '@studio/exporters/node';
import { ensureChromium } from './runtime';
import { ProductsRegistry } from './productsFile';
import { claudeSignIn, setupStatus } from './setup';
import { checkOverlay } from './overlayCheck';
import { RunManager } from './runs';
import { Library } from './library';
import { Explainers } from './explainers';
import { checkScene } from './sceneCheck';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  access,
  readdir,
  mkdir as mkdirp,
  readFile as readFileP,
  writeFile as writeFileP,
} from 'node:fs/promises';
import {
  getProduct,
  launchCheck,
  openSignIn,
  probe,
  runSample,
  signInStatus,
  signOut,
} from '@studio/recorder/node';
import os from 'node:os';
import path from 'node:path';

export const ENGINE_VERSION = '0.0.1';

export interface EngineOptions {
  workspace: string;
  /** 0 picks a free port. */
  port?: number;
  /** Generated when omitted. */
  token?: string;
  logger?: boolean;
  /** Replaces the ElevenLabs service (tests). */
  tts?: TtsService;
}

export interface Engine {
  port: number;
  token: string;
  url: string;
  app: FastifyInstance;
  broadcast<E extends RpcEvent>(event: E, data: RpcEventData<E>): void;
  close(): Promise<void>;
}

type Handlers = { [M in RpcMethod]: (params: never) => Promise<RpcResult<M>> };

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

export async function startEngine(opts: EngineOptions): Promise<Engine> {
  const token = opts.token ?? randomBytes(24).toString('hex');
  await mkdir(opts.workspace, { recursive: true });
  // The recorder launches what the workspace's products.json says.
  const products = new ProductsRegistry(opts.workspace);
  await products.load();
  const store = new ProjectStore(opts.workspace);
  const workspace = new Workspace(opts.workspace);
  const timelines = new TimelineStore(store, (e) => broadcast('timeline.changed', e));
  // Composited frames for check_overlay (and later export); it needs the engine's own address.
  let listening = { port: 0, token };
  const headless = new HeadlessStage(() => listening);
  const runner = new Runner(store, workspace, (event, data) => broadcast(event, data));
  let overlayServer: Promise<OverlayServer> | null = null;
  let overlayVersion = 0;
  const overlays = () =>
    (overlayServer ??= startOverlayServer(opts.workspace, (c) =>
      broadcast('overlays.changed', { ...c, version: ++overlayVersion }),
    ));
  const agents: AgentManager = new AgentManager({
    projectDir: (slug) => store.dir(slug),
    permissionMode: async (slug) => ((await store.readBrief(slug)).autoMode ? 'auto' : 'default'),
    workspaceDir: opts.workspace,
    mcpServers: (slug) =>
      studioServer({
        slug,
        store,
        timelines,
        runner,
        pipeline,
        voiceover,
        explainers,
        docs,
        checkScene: async (sceneId) =>
          checkScene({
            workspace: opts.workspace,
            slug,
            sceneId,
            timeline: (await timelines.get(slug)).timeline,
            overlays: await overlays(),
            stage: headless,
          }),
        checkOverlay: async (file, o) =>
          checkOverlay({
            workspace: opts.workspace,
            slug,
            file,
            timeline: (await timelines.get(slug)).timeline,
            overlays: await overlays(),
            stage: headless,
            ...o,
          }),
        onTake: () => {
          timelines.invalidate(slug);
          broadcast('project.changed', { slug });
        },
        catalog: async () => loadCatalog(await overlays(), slug),
        runId: (): string => agents.get(slug).runId,
      }),
    skills: async () =>
      (await readdir(path.join(opts.workspace, '.claude', 'skills'), { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    emit: (e) => broadcast('agent.event', e),
    state: (s) => broadcast('agent.state', s),
  });
  const knowledge = new WorkspaceGit(opts.workspace);
  const tts = opts.tts ?? new TtsService(secretStore(), (slug) => store.dir(slug));
  // The packaged app downloads Chromium on first run (in the background, and before a render
  // host needs it).
  const chromiumLog = (line: string) => process.stderr.write(`[chromium] ${line}\n`);
  beforeBrowserLaunch(() => ensureChromium(chromiumLog));
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) void ensureChromium(chromiumLog).catch(() => {});
  const timing = new TimingFit({ store, timelines });
  const runs = new RunManager({
    workspace: opts.workspace,
    store,
    timelines,
    agents,
    render: (slug, times) => headless.render(slug, times),
    emit: (slug) => broadcast('runs.changed', { slug }),
  });
  /**
   * Applies a scene edit as one patch, then rebuilds what lives in output time and is derived
   * (captions from the voice-over, automatic overlays from the recording).
   */
  const sceneEdit = async (slug: string, label: string, edit: (tl: Timeline) => Timeline) => {
    const { timeline } = await timelines.get(slug);
    let next = withCaptions(edit(timeline));
    const take = next.takes.at(-1);
    if (take)
      next = withAutoOverlays(next, await readEvents(store.dir(slug), take.events), {
        title: (await store.open(slug)).project.title,
      });
    const keys = ['scenes', 'transitions', 'overlays', 'captions', 'annotations', 'voice'] as const;
    const patch = keys
      .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(timeline[k]))
      .map((k) => ({ op: 'replace' as const, path: `/${k}`, value: next[k] }));
    return timelines.patch(slug, patch, { author: 'user', label });
  };
  /** Inserts an explainer (FreezeMorph in and out next to the recording); returns the new state and its id. */
  const insertScene = async (
    slug: string,
    at: number,
    component: string,
    props: Record<string, unknown>,
    duration?: number,
    transitions = true,
  ) => {
    let sceneId = '';
    const state = await sceneEdit(slug, 'Insert explainer', (tl) => {
      const inserted = insertExplainerScene(tl, at, {
        kind: 'explainer',
        component,
        props,
        narration: [],
        beats: [],
        duration: duration ?? 'auto',
        estimatedDuration: duration ?? 6,
      });
      sceneId = inserted.sceneId;
      const next = inserted.timeline;
      if (!transitions) return next;
      const i = next.scenes.findIndex((s) => s.id === sceneId);
      const before = next.scenes[i - 1];
      const after = next.scenes[i + 1];
      const morph = (a: string, b: string) => ({
        id: `tr-${a}-${b}`,
        between: [a, b] as [string, string],
        component: 'core:FreezeMorph',
        duration: 1,
      });
      const withTransitions = {
        ...next,
        transitions: [
          ...next.transitions,
          ...(before?.kind === 'recording' ? [morph(before.id, sceneId)] : []),
          ...(after?.kind === 'recording' ? [morph(sceneId, after.id)] : []),
        ],
      };
      // Transitions overlap the scenes: move later items by what the video actually gained.
      return remapOutputItems(withTransitions, outputRemapper(next, withTransitions));
    });
    return { state, sceneId };
  };
  const explainers = new Explainers({
    store,
    timelines,
    catalog: async (slug) => loadCatalog(await overlays(), slug),
    insertScene: async (slug, at, component, props) =>
      (await insertScene(slug, at, component, props)).sceneId,
    removeScene: async (slug, sceneId) => {
      await sceneEdit(slug, 'Remove explainer', (tl) => removeExplainerScene(tl, sceneId));
    },
    send: async (slug, text) => {
      await workspace.ensure();
      await runs.begin(slug, { prompt: text.split('\n')[0]!.slice(0, 200) });
      await agents.get(slug).send(text);
    },
    emit: (slug) => broadcast('explainers.changed', { slug }),
  });
  // Stills for the Markdown doc: exact frames from an export-mode host (software WebGL is fine).
  const stills = new RenderHost({
    engine: () => listening,
    uiUrl: () => resolveUiUrl(`http://127.0.0.1:${listening.port}`),
    exportMode: true,
  });
  const docs = new DocWriter({
    store,
    timelines,
    send: async (slug, text) => {
      await workspace.ensure();
      await runs.begin(slug, { prompt: text.split('\n')[0]!.slice(0, 200) });
      await agents.get(slug).send(text);
    },
    render: async (slug, t, timeline) => (await stills.render(slug, [t], timeline))[0]!.png,
  });
  const exporter = new Exporter({
    store,
    timelines,
    docs,
    workspace: opts.workspace,
    engine: () => listening,
    emit: (state) => broadcast('export.progress', state),
    frame: (f) => broadcast('export.frame', f),
  });
  const library = new Library({
    workspace: opts.workspace,
    timelines,
    overlays: () => overlays(),
    check: async (slug, file) =>
      checkOverlay({
        workspace: opts.workspace,
        slug,
        file,
        timeline: (await timelines.get(slug)).timeline,
        overlays: await overlays(),
        stage: headless,
      }),
    checkScene: async (slug, sceneId) =>
      checkScene({
        workspace: opts.workspace,
        slug,
        sceneId,
        timeline: (await timelines.get(slug)).timeline,
        overlays: await overlays(),
        stage: headless,
      }),
    commit: async (message, paths) => {
      const head = await workspace.commit(message, paths);
      broadcast('workspace.changed', { head });
      return head;
    },
  });
  const voiceover = new Voiceover({ store, timelines, tts, after: (slug, o) => timing.fit(slug, o) });
  const pipeline: PipelineManager = new PipelineManager({
    store,
    agents,
    runProject: (slug, mode) => runner.runProject(slug, mode),
    stopRun: () => runner.stop(),
    onTake: (slug) => {
      timelines.invalidate(slug);
      broadcast('project.changed', { slug });
    },
    emit: (s) => broadcast('pipeline.changed', s),
    voiceover: async (slug, group, narration) => {
      if (!(await store.voiceFor(slug))) return 'No voice chosen in the brief, so no voice-over yet.';
      if (!(await tts.status()).configured) return 'ElevenLabs has no key yet, so no voice-over.';
      if (narration) {
        // A paced take: its steps get the narration it was recorded against.
        const { timeline } = await timelines.get(slug);
        const ops = timeline.steps.flatMap((s, i) => {
          const text = narration.steps.find((p) => p.id === s.id)?.narration.trim();
          return text !== undefined && text !== s.narration
            ? [{ op: 'replace' as const, path: `/steps/${i}/narration`, value: text }]
            : [];
        });
        if (ops.length) await timelines.patch(slug, ops, { author: 'auto', group, label: 'Final narration' });
      }
      const r = await voiceover.generate(slug, { author: 'auto', group });
      return `Voice-over: ${r.lines.length} lines, ${r.seconds.toFixed(1)} s.`;
    },
    pace: {
      blocker: async (slug) =>
        !(await store.voiceFor(slug))
          ? 'No voice chosen in the brief.'
          : !(await tts.status()).configured
            ? 'ElevenLabs has no key yet.'
            : null,
      voice: async (slug, plan) => {
        const r = await voicePace({ store, tts }, slug, plan.steps);
        return `Voiced ${r.lines} line${r.lines === 1 ? '' : 's'} (${r.seconds.toFixed(1)} s) to pace the take`;
      },
      clear: (slug) => clearPace(store.dir(slug)),
    },
    costLimit: async () => (await store.readSettings()).maxCostPerRun,
    git: knowledge,
    onCommit: () => void workspace.status().then((st) => broadcast('workspace.changed', { head: st.head })),
  });
  const app = Fastify({ logger: opts.logger ?? false });

  const tokenOk = (candidate: unknown) => {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  // Everything except /health needs the session token (header, or query for <video>/WS).
  // The UI runs on another origin (tauri://localhost, or Vite in dev) and reads media with
  // fetch and as WebGL video textures, which both need CORS. Access stays token-protected.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', `range, content-type, ${TOKEN_HEADER}`);
    reply.header('access-control-expose-headers', 'content-range, accept-ranges, content-length');
    if (req.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET, HEAD, OPTIONS');
      return reply.code(204).send();
    }
    if (req.url === '/health' || isUiPath(req.url)) return;
    const q = (req.query as Record<string, unknown> | undefined)?.[TOKEN_QUERY];
    if (!tokenOk(req.headers[TOKEN_HEADER]) && !tokenOk(q))
      return reply.code(401).send({ error: 'unauthorized' });
  });
  app.get('/health', async () => ({ ok: true, version: ENGINE_VERSION }));
  // Library thumbnails (workspace overlays/thumbs/<Name>.jpg); token-checked like media.
  app.get<{ Params: { name: string }; Querystring: { kind?: string } }>(
    '/library/thumb/:name',
    async (req, reply) => {
      const file = library.thumbPath(req.params.name, req.query.kind === 'scene' ? 'scene' : 'overlay');
      if (!file) return reply.code(404).send({ error: 'not found' });
      reply.header('content-type', 'image/jpeg');
      reply.header('cache-control', 'no-cache');
      return reply.send(await readFileP(file));
    },
  );
  registerMedia(app, store);
  registerUi(app);

  const handlers: Handlers = {
    'pipeline.get': async ({ slug }: { slug: string }) => {
      await store.open(slug);
      return pipeline.get(slug);
    },
    'pipeline.start': async ({ slug, gates }: { slug: string; gates?: { storyboard?: boolean } }) => {
      await workspace.ensure();
      return pipeline.start(slug, gates ?? {});
    },
    'pipeline.approve': async ({ slug }: { slug: string }) => pipeline.approve(slug),
    'pipeline.revise': async ({ slug, feedback }: { slug: string; feedback: string }) =>
      pipeline.revise(slug, feedback),
    'pipeline.stop': async ({ slug }: { slug: string }) => pipeline.stop(slug),
    'pipeline.editPlan': async ({ slug, edits }: { slug: string; edits: PlanEdit[] }) =>
      pipeline.editPlan(slug, edits),
    'brief.get': async ({ slug }: { slug: string }) => store.readBrief(slug),
    'brief.save': async ({ slug, brief }: { slug: string; brief: Brief }) => {
      const saved = await store.saveBrief(slug, brief);
      await agents
        .get(slug)
        .setPermissionMode(saved.autoMode ? 'auto' : 'default')
        .catch((e: unknown) =>
          console.error(`[agent ${slug}] could not change the permission mode: ${String(e)}`),
        );
      broadcast('project.changed', { slug });
      return saved;
    },
    'brief.addReference': async ({
      slug,
      source,
    }: {
      slug: string;
      source: RpcParams<'brief.addReference'>['source'];
    }) => store.addReference(slug, source),
    'brief.removeReference': async ({ slug, index }: { slug: string; index: number }) =>
      store.removeReference(slug, index),
    'skills.coverage': async ({ product, goal }: { product: string; goal: string }) =>
      skillCoverage(opts.workspace, product, goal),
    'knowledge.summary': async () => knowledgeSummary(opts.workspace),
    'vo.generate': async ({ slug, stepIds }: { slug: string; stepIds?: string[] }) =>
      voiceover.generate(slug, {
        ...(stepIds ? { stepIds } : {}),
        author: 'user',
        group: `vo-${Date.now()}`,
      }),
    'overlays.auto': async ({ slug }: { slug: string }) => {
      const { timeline } = await timelines.get(slug);
      const take = timeline.takes.at(-1);
      if (!take) throw new RpcError('this project has no take yet', 'bad_request');
      const events = await readEvents(store.dir(slug), take.events);
      const next = withAutoOverlays(timeline, events, { title: (await store.open(slug)).project.title });
      const r = await timelines.patch(slug, [{ op: 'replace', path: '/overlays', value: next.overlays }], {
        author: 'auto',
        label: 'Automatic overlays',
      });
      return { ...r, count: next.overlays.filter((o) => o.author === 'auto').length };
    },
    'annotations.send': async ({ slug, ids }: { slug: string; ids?: string[] }) => {
      const { timeline } = await timelines.get(slug);
      const take = timeline.takes.at(-1);
      const events = take ? await readEvents(store.dir(slug), take.events) : [];
      const msg = await annotationMessage({
        timeline,
        projectDir: store.dir(slug),
        events,
        ...(ids ? { ids } : {}),
      });
      await workspace.ensure();
      await runs.begin(slug, {
        prompt: msg.ids
          .map((id) => timeline.annotations.find((a) => a.id === id)?.comment ?? '')
          .filter(Boolean)
          .join(' · '),
        annotationIds: msg.ids,
      });
      await agents.get(slug).send(msg.text, 'user', msg.images);
      const session = agents.get(slug);
      await timelines.patch(
        slug,
        msg.ids.flatMap((id) => {
          const i = timeline.annotations.findIndex((a) => a.id === id);
          return [
            { op: 'replace' as const, path: `/annotations/${i}/status`, value: 'sent' },
            { op: 'add' as const, path: `/annotations/${i}/runId`, value: session.runId },
          ];
        }),
        { author: 'user', label: 'Send annotations to the agent' },
      );
      return { sent: msg.ids.length, images: msg.images.length };
    },
    'scenes.insert': async (p: {
      slug: string;
      at: number;
      component: string;
      props?: Record<string, unknown>;
      duration?: number;
      transitions?: boolean;
    }) =>
      (await insertScene(p.slug, p.at, p.component, p.props ?? {}, p.duration, p.transitions !== false))
        .state,
    'explainers.list': async ({ slug }: { slug: string }) => explainers.list(slug),
    'explainers.start': async ({ slug, at, brief }: { slug: string; at: number; brief: string }) =>
      explainers.start(slug, at, brief, true),
    'explainers.editBeat': async (p: { slug: string; sceneId: string; beatId: string; narration: string }) =>
      explainers.editBeat(p.slug, p.sceneId, p.beatId, p.narration),
    'explainers.approve': async ({ slug, sceneId }: { slug: string; sceneId: string }) =>
      explainers.approve(slug, sceneId),
    'explainers.revise': async ({
      slug,
      sceneId,
      feedback,
    }: {
      slug: string;
      sceneId: string;
      feedback: string;
    }) => explainers.revise(slug, sceneId, feedback),
    'explainers.cancel': async ({ slug, sceneId }: { slug: string; sceneId: string }) =>
      explainers.cancel(slug, sceneId),
    'scenes.remove': async ({ slug, sceneId }: { slug: string; sceneId: string }) =>
      sceneEdit(slug, 'Remove explainer', (tl) => {
        try {
          return removeExplainerScene(tl, sceneId);
        } catch (e) {
          throw new RpcError(e instanceof Error ? e.message : String(e), 'not_found');
        }
      }),
    'library.index': async () => library.index(),
    'library.promote': async ({ slug, id }: { slug: string; id: string }) => library.promote(slug, id),
    'runs.list': async ({ slug }: { slug: string }) =>
      (await runs.list(slug)).filter((r) => r.status !== 'empty'),
    'runs.get': async ({ slug, n }: { slug: string; n: number }) => ({
      run: await runs.get(slug, n),
      diff: await runs.diff(slug, n),
    }),
    'runs.accept': async ({ slug, n }: { slug: string; n: number }) => runs.accept(slug, n),
    'runs.reopen': async ({ slug, n }: { slug: string; n: number }) => runs.reopen(slug, n),
    'runs.revert': async ({ slug, n }: { slug: string; n: number }) => runs.revert(slug, n),
    'runs.followUp': async ({ slug, n, text }: { slug: string; n: number; text: string }) => {
      const r = await runs.get(slug, n);
      const message = `Follow-up on run #${n}${r.annotationIds.length ? ' (the same annotations)' : ''}: ${text}`;
      await runs.begin(slug, { prompt: text, annotationIds: r.annotationIds });
      await agents.get(slug).send(message);
      return { queued: true };
    },
    'captions.build': async ({ slug }: { slug: string }) => {
      const { timeline } = await timelines.get(slug);
      if (!timeline.voice.length) throw new RpcError('There is no voice-over to caption yet.', 'bad_request');
      const next = withCaptions(timeline);
      const take = timeline.takes.at(-1);
      const overlays = take
        ? withAutoOverlays(next, await readEvents(store.dir(slug), take.events), {
            title: (await store.open(slug)).project.title,
          }).overlays
        : next.overlays;
      return timelines.patch(
        slug,
        [
          { op: 'replace', path: '/captions', value: next.captions },
          { op: 'replace', path: '/overlays', value: overlays },
        ],
        { author: 'user', group: `captions-${Date.now()}`, label: 'Build captions' },
      );
    },
    'timing.fit': async ({ slug }: { slug: string }) =>
      timing.fit(slug, { author: 'user', group: `fit-${Date.now()}` }),
    'vo.peaks': async ({ slug, audio }: { slug: string; audio: string }) => voiceover.peaks(slug, audio),
    'tts.status': async () => tts.status(),
    'tts.setKey': async ({ apiKey }: { apiKey: string }) => tts.setKey(apiKey),
    'tts.clearKey': async () => tts.clearKey(),
    'voices.list': async ({ refresh }: { refresh: boolean }) => tts.listVoices(refresh),
    'tts.synthesize': async (p: { slug: string; text: string; voiceId: string; modelId?: string }) => {
      await store.open(p.slug);
      const r = await tts.synthesize(p.slug, {
        text: p.text,
        voiceId: p.voiceId,
        ...(p.modelId ? { modelId: p.modelId } : {}),
      });
      return { hash: r.hash, audio: r.audio, duration: r.duration, cached: r.cached, alignment: r.alignment };
    },
    'agent.status': async ({ slug, history }: { slug: string; history: number }) => {
      await store.open(slug);
      return agents.get(slug).status(history);
    },
    'agent.send': async ({ slug, text }: { slug: string; text: string }) => {
      await store.open(slug);
      await workspace.ensure();
      await runs.begin(slug, { prompt: text });
      await agents.get(slug).send(text);
      return { queued: true };
    },
    'agent.interrupt': async ({ slug }: { slug: string }) => ({
      interrupted: await agents.get(slug).interrupt(),
    }),
    'agent.reset': async ({ slug }: { slug: string }) => agents.get(slug).reset(),
    'export.start': async ({ slug, settings }: { slug: string; settings: ExportSettings }) =>
      exporter.start(slug, settings),
    'export.plan': async ({ slug, settings }: { slug: string; settings: ExportSettings }) =>
      exporter.plan(slug, settings),
    'export.cancel': async ({ slug }: { slug: string }) => ({ cancelled: await exporter.cancel(slug) }),
    'export.status': async ({ slug }: { slug: string }) => exporter.status(slug),
    'product.signInStatus': async ({ product }: { product: string }) => signInStatus(getProduct(product).id),
    'product.signIn': async ({ product }: { product: string }) => {
      const id = getProduct(product).id;
      if (runner.busy) throw new RpcError('Wait for the current run to finish first.', 'bad_request');
      const { closed } = await openSignIn(id, {
        onProgress: (message) => broadcast('recorder.progress', { message, at: Date.now() }),
      }).catch((e: unknown) => {
        throw new RpcError(e instanceof Error ? e.message : String(e), 'bad_request');
      });
      void closed.then(async () => broadcast('product.signInChanged', await signInStatus(id)));
      const st = await signInStatus(id);
      broadcast('product.signInChanged', st);
      return st;
    },
    'product.signOut': async ({ product }: { product: string }) => {
      const id = getProduct(product).id;
      await signOut(id).catch((e: unknown) => {
        throw new RpcError(e instanceof Error ? e.message : String(e), 'bad_request');
      });
      const st = await signInStatus(id);
      broadcast('product.signInChanged', st);
      return st;
    },
    'project.reveal': async ({ slug, path: rel }: { slug: string; path: string }) => {
      const dir = store.dir(slug);
      const file = path.resolve(dir, rel);
      if (!file.startsWith(dir + path.sep) || !existsSync(file))
        throw new RpcError(`no ${rel} in this project`, 'not_found');
      if (process.platform !== 'darwin') return { ok: false };
      await new Promise<void>((resolve, reject) =>
        execFile('open', ['-R', file], (err) => (err ? reject(err) : resolve())),
      );
      return { ok: true };
    },
    'agent.permission': async (p: { slug: string; requestId: string; allow: boolean; message?: string }) => ({
      resolved: agents.get(p.slug).answerPermission(p.requestId, p.allow, p.message),
    }),
    'timeline.get': async ({ slug }: { slug: string }) => timelines.get(slug),
    'timeline.patch': async (p: {
      slug: string;
      patch: unknown;
      author: Author;
      group: string | null;
      label?: string;
    }) =>
      timelines.patch(p.slug, p.patch, {
        author: p.author,
        group: p.group,
        ...(p.label ? { label: p.label } : {}),
      }),
    'timeline.undo': async ({ slug }: { slug: string }) => timelines.undo(slug),
    'timeline.redo': async ({ slug }: { slug: string }) => timelines.redo(slug),
    'timeline.rebuildFromTake': async ({ slug }: { slug: string }) => {
      const { timeline } = await timelines.get(slug);
      const take = timeline.takes.at(-1);
      if (!take) throw new RpcError('this project has no take yet', 'bad_request');
      const text = await readFileP(path.join(store.dir(slug), take.events), 'utf8');
      const events = text
        .split('\n')
        .filter(Boolean)
        .map((l) => RecorderEvent.parse(JSON.parse(l)));
      const next = withAutoOverlays(withTake(timeline, take, events), events, {
        title: (await store.open(slug)).project.title,
      });
      return timelines.patch(
        slug,
        [
          { op: 'replace', path: '/scenes', value: next.scenes },
          { op: 'replace', path: '/transitions', value: next.transitions },
          { op: 'replace', path: '/steps', value: next.steps },
          { op: 'replace', path: '/overlays', value: next.overlays },
        ],
        { author: 'auto', label: 'Rebuild from take' },
      );
    },
    'overlays.info': async () => ({ url: (await overlays()).url }),
    'overlays.list': async ({ slug }: { slug?: string }) => (await overlays()).list(slug),
    'overlays.writeSample': async ({ slug }: { slug: string }) => {
      const rel = `projects/${slug}/overlays/HelloOverlay.tsx`;
      const abs = path.join(store.dir(slug), 'overlays', 'HelloOverlay.tsx');
      await mkdirp(path.dirname(abs), { recursive: true });
      const exists = await access(abs).then(
        () => true,
        () => false,
      );
      if (!exists) await writeFileP(abs, HELLO_OVERLAY);
      await overlays();
      return { id: 'project:HelloOverlay', path: rel, absolutePath: abs };
    },
    'workspace.show': async ({ hash }: { hash: string }) => knowledge.show(hash),
    'workspace.openInEditor': async ({ path: rel }: { path: string }) => {
      const abs = path.resolve(opts.workspace, rel);
      if (!abs.startsWith(path.resolve(opts.workspace) + path.sep))
        throw new RpcError('path is outside the workspace', 'bad_request');
      const opened = await new Promise<boolean>((resolve) =>
        execFile('code', ['--reuse-window', abs], (err) => resolve(!err)),
      );
      return { opened };
    },
    'recorder.stop': async () => ({ stopping: runner.stop() || (await runner.closeInspector()) }),
    ping: async ({ sentAt }: { sentAt: number }) => ({
      sentAt,
      engineVersion: ENGINE_VERSION,
      workspace: opts.workspace,
    }),
    'project.list': async () =>
      Promise.all(
        (await store.list()).map(async (p) =>
          projectCard(
            p,
            store.dir(p.slug),
            await timelines.get(p.slug).then(
              (t) => t.timeline,
              () => null,
            ),
            await pipeline.get(p.slug),
          ),
        ),
      ),
    'project.create': async (p: { title: string; product: string; brief?: Partial<Brief> }) => {
      await workspace.ensure();
      const project = await store.create(p);
      const head = await workspace.commit(`project: create ${project.slug}`, [`projects/${project.slug}`]);
      broadcast('project.changed', { slug: project.slug });
      broadcast('workspace.changed', { head });
      return project;
    },
    'project.open': async ({ slug }: { slug: string }) => store.open(slug),
    'project.delete': async ({ slug }: { slug: string }) => {
      await store.open(slug);
      // Nothing may still be writing into the folder.
      if (runner.session?.slug === slug)
        throw new RpcError('A run of this project is streaming to Live. Stop it first.', 'bad_request');
      if (exporter.status(slug)?.state === 'running')
        throw new RpcError('This project is exporting. Cancel the export first.', 'bad_request');
      const pipe = await pipeline.get(slug);
      if (pipe.status === 'running')
        throw new RpcError("This project's pipeline is running. Stop it first.", 'bad_request');
      if (pipe.status === 'waiting') await pipeline.stop(slug);
      pipeline.forget(slug);
      await agents.remove(slug);
      await store.remove(slug);
      timelines.invalidate(slug);
      const head = await workspace.commit(`project: delete ${slug}`, [`projects/${slug}`]);
      broadcast('project.changed', { slug });
      broadcast('workspace.changed', { head });
      return { deleted: true, commit: head };
    },
    'workspace.status': async () => workspace.status(),
    'workspace.init': async () => {
      const status = await workspace.init();
      broadcast('workspace.changed', { head: status.head });
      return status;
    },
    'workspace.tree': async () => workspace.tree(),
    'workspace.read': async ({ path: rel }: { path: string }) => ({
      path: rel,
      text: await workspace.read(rel),
    }),
    'workspace.log': async ({ limit }: { limit: number }) => workspace.log(limit),
    'recorder.launchCheck': async ({ product }: { product: string }) => {
      const r = await runner.withLock('launch check', () =>
        launchCheck(product, (message) => broadcast('recorder.progress', { message, at: Date.now() })),
      );
      const { png, ...size } = r.screenshot;
      return { ...r, screenshot: { ...size, dataUrl: dataUrl(png) } };
    },
    'live.status': async () => ({ session: runner.session }),
    'settings.get': async () => ({
      ...(await store.readSettings()),
      workspace: opts.workspace,
      packaged: process.env.STUDIO_PACKAGED === '1',
    }),
    'settings.update': async (patch: Partial<StudioSettings>) => ({
      ...(await store.updateSettings(patch)),
      workspace: opts.workspace,
      packaged: process.env.STUDIO_PACKAGED === '1',
    }),
    'products.list': async () => products.list(),
    'products.save': async ({ products: list }: { products: ProductConfig[] }) => {
      const r = await products.save(list);
      await workspace.commit('settings: products.json', ['products.json']).catch(() => null);
      return r;
    },
    'setup.status': async () => setupStatus({ store, workspace, tts, products }),
    'agent.signInStatus': async () => claudeSignIn(),
    'project.record': async ({ slug, mode }: { slug: string; mode: 'dry' | 'record' }) => {
      const r = await runner.runProject(slug, mode);
      if (r.take) {
        timelines.invalidate(slug);
        broadcast('project.changed', { slug });
      }
      return {
        passed: r.passed,
        slug,
        takePath: r.takePath,
        take: r.take,
        codec: r.codec,
        steps: stepTimings(r.events),
        failure: r.failure && {
          stepId: r.failure.stepId,
          title: r.failure.title,
          error: r.failure.error,
          dataUrl: r.failure.screenshot.length ? dataUrl(r.failure.screenshot) : '',
        },
        durationMs: r.durationMs,
      };
    },
    'recorder.recordSampleTake': async () => {
      const slug = 'recorder-samples';
      const title = 'Sample: Greeting Service overview';
      return runner.exclusive(title, 'record', async (cb) => {
        await workspace.ensure();
        await store.ensure(slug, 'Recorder samples', 'wso2-integrator');
        const takeId = await store.nextTakeId(slug);
        const takePath = `recordings/${takeId}`;
        const takeDir = path.join(store.dir(slug), takePath);
        const r = await runSample({ mode: 'record', takeDir, takeId, ...cb });
        if (!r.take)
          throw new RpcError(
            r.failure ? `step ${r.failure.stepId} failed: ${r.failure.error}` : 'no take was recorded',
          );
        const info = await probe(path.join(takeDir, 'video.mp4'));
        await workspace.commit(`take: ${slug}/${takeId}`, [`projects/${slug}`]);
        return { slug, takePath, take: r.take, codec: info.codec, frames: info.frames, events: r.events };
      });
    },
    'recorder.runSample': async ({ mode, broken }: { mode: 'dry' | 'record'; broken: boolean }) => {
      const title = 'Sample: Greeting Service overview';
      const eventsFile = path.join(os.tmpdir(), 'tutorial-studio', `sample-${mode}.jsonl`);
      return runner.exclusive(title, mode, async (cb) => {
        const r = await runSample({ mode, broken, eventsFile, ...cb });
        return {
          passed: r.passed,
          mode: r.mode,
          viewport: r.viewport,
          eventsFile,
          events: r.events,
          targetFrames: r.targetFrames.map(({ png, ...f }) => ({ ...f, dataUrl: dataUrl(png) })),
          failure: r.failure && {
            stepId: r.failure.stepId,
            title: r.failure.title,
            error: r.failure.error,
            dataUrl: r.failure.screenshot.length ? dataUrl(r.failure.screenshot) : '',
            ariaSnapshot: r.failure.ariaSnapshot,
            webviewAriaSnapshot: r.failure.webviewAriaSnapshot,
          },
          durationMs: r.durationMs,
        };
      });
    },
  };

  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (u.pathname !== '/rpc' || !tokenOk(u.searchParams.get(TOKEN_QUERY))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws: WebSocket) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', async (raw) => {
      let id = -1;
      try {
        const req = RpcRequest.parse(JSON.parse(String(raw)));
        id = req.id;
        const method = req.method as RpcMethod;
        const def = rpcMethods[method];
        if (!def) throw new RpcError(`unknown method "${req.method}"`, 'unknown_method');
        const params = def.params.safeParse(req.params ?? {});
        if (!params.success) throw new RpcError(formatIssues(params.error), 'bad_request');
        const result = await (handlers[method] as (p: unknown) => Promise<unknown>)(params.data);
        send(ws, { id, result });
      } catch (e) {
        const err =
          e instanceof RpcError ? e : new RpcError(e instanceof Error ? e.message : String(e), 'internal');
        send(ws, { id, error: { message: err.message, code: err.code } });
      }
    });
  });

  function send(ws: WebSocket, msg: RpcReply) {
    ws.send(JSON.stringify(msg));
  }

  function broadcast<E extends RpcEvent>(event: E, data: RpcEventData<E>) {
    const text = JSON.stringify({ event, data });
    for (const ws of sockets) ws.send(text);
  }

  await app.listen({ host: '127.0.0.1', port: opts.port ?? 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  listening = { port, token };

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}`,
    app,
    broadcast,
    async close() {
      await agents.closeAll().catch(() => {});
      await runner.close();
      await exporter.close();
      await stills.close();
      await headless.close();
      if (overlayServer) await (await overlayServer).close().catch(() => {});
      for (const ws of sockets) ws.terminate();
      wss.close();
      await app.close();
    },
  };
}
