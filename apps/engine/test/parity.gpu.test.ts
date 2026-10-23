import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  buildTimeMap,
  createEngineClient,
  type EngineClient,
  type RecorderEvent,
  type Timeline,
} from '@studio/core';
import { diffFrames, RenderHost, renderFrames, type FrameDiff } from '@studio/exporters/node';
import { startEngine, type Engine } from '../src/server';
import { UI_DIST } from '../src/ui';

/**
 * Preview/export parity and export determinism (`pnpm test:parity`). Needs the GPU, Playwright's
 * Chromium and WebKit, ffmpeg and the built app (the script builds it first).
 *
 * A fixture project (a synthetic H.264 take with two steps, the automatic overlays, core and
 * agent-written overlays, captions, and an explainer with FreezeMorph transitions) is rendered:
 *  - as the preview shows it: the render page in WebKit (the engine of the app's webview), in
 *    preview mode (a seeking <video>);
 *  - as export draws it: the render page in GPU Chromium, in export mode (WebCodecs frames).
 * Each pair of frames must be within TOLERANCE, and export must render the same bytes twice.
 */

/** Mean absolute difference per channel (0–255), and share of pixels off by more than 24. */
export const TOLERANCE = { mean: 2, changed: 0.01 };

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const artifacts = path.join(repo, 'test-results', 'parity');

describe.runIf(process.env.STUDIO_PARITY)('preview/export parity', () => {
  let workspace: string;
  let engine: Engine;
  let client: EngineClient;
  let slug: string;
  let timeline: Timeline;

  beforeAll(async () => {
    if (!existsSync(path.join(UI_DIST, 'index.html')))
      throw new Error('build the app first: pnpm --filter @studio/desktop build');
    workspace = await mkdtemp(path.join(os.tmpdir(), 'studio-parity-'));
    engine = await startEngine({ workspace });
    // Render pages come from this engine's built app, not a dev server that may be running.
    process.env.STUDIO_UI_URL = engine.url;
    client = createEngineClient({
      url: `ws://127.0.0.1:${engine.port}/rpc`,
      token: engine.token,
      WebSocket: WebSocket as never,
      reconnectMs: 0,
    });
    slug = (await client.call('project.create', { title: 'Parity fixture', product: 'wso2-integrator' }))
      .slug;
    timeline = await makeFixture(client, path.join(workspace, 'projects', slug), slug);
    await rm(artifacts, { recursive: true, force: true });
    await mkdir(artifacts, { recursive: true });
  }, 120_000);

  afterAll(async () => {
    delete process.env.STUDIO_UI_URL;
    client?.close();
    await engine?.close();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('export frames match the preview within tolerance', async () => {
    const times = sampleTimes(timeline);
    const engineInfo = () => ({ port: engine.port, token: engine.token });
    const host = new RenderHost({
      engine: engineInfo,
      uiUrl: engine.url,
      exportMode: true,
      requireGpu: true,
    });
    let browser: Browser | null = null;
    const results: { t: number; what: string; diff: FrameDiff }[] = [];
    try {
      const exported = await host.render(
        slug,
        times.map((x) => x.t),
      );
      browser = await webkit.launch();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(
        `${engine.url}/#/render/${slug}?engine=${engine.port}&token=${encodeURIComponent(engine.token)}`,
      );
      await page.waitForFunction(() => window.__studioReady === true, null, { timeout: 30_000 });
      for (const [i, { t, what }] of times.entries()) {
        const { errors } = await page.evaluate((req) => window.__studioRender!(req), { t });
        expect(errors, `preview errors at ${t}`).toEqual({});
        expect(exported[i]!.errors, `export errors at ${t}`).toEqual({});
        const preview = await page.locator('[data-stage-surface]').screenshot({ type: 'png' });
        const diff = await diffFrames(exported[i]!.png, preview);
        results.push({ t, what, diff });
        const name = `${String(i).padStart(2, '0')}-${what.replace(/\W+/g, '-')}`;
        await writeFile(path.join(artifacts, `${name}-export.png`), exported[i]!.png);
        await writeFile(path.join(artifacts, `${name}-preview.png`), preview);
      }
    } finally {
      await host.close();
      await browser?.close();
    }
    const report = results
      .map(
        (r) =>
          `${r.t.toFixed(2).padStart(6)} s  ${r.what.padEnd(28)} mean ${r.diff.mean.toFixed(3)}  changed ${(r.diff.changed * 100).toFixed(3)}%  max ${r.diff.maxChannel}`,
      )
      .join('\n');
    await writeFile(
      path.join(artifacts, 'report.txt'),
      `tolerance: ${JSON.stringify(TOLERANCE)}\n${report}\n`,
    );
    console.log(report);
    for (const r of results) {
      expect(r.diff.mean, `${r.what} at ${r.t}`).toBeLessThanOrEqual(TOLERANCE.mean);
      expect(r.diff.changed, `${r.what} at ${r.t}`).toBeLessThanOrEqual(TOLERANCE.changed);
    }
  }, 300_000);

  it('export renders the same bytes twice (recording, transition and explainer)', async () => {
    const tm = buildTimeMap(timeline);
    const explainer = tm.scenes.find(
      (s) => timeline.scenes.find((x) => x.id === s.sceneId)?.kind === 'explainer',
    )!;
    const fps = 30;
    const ranges = [
      { from: 0, to: 45, fps },
      { from: Math.round((explainer.start - 0.4) * fps), to: Math.round((explainer.start + 1) * fps), fps },
    ];
    const pass = async () => {
      const host = new RenderHost({
        engine: () => ({ port: engine.port, token: engine.token }),
        uiUrl: engine.url,
        exportMode: true,
        requireGpu: true,
      });
      const hashes: string[] = [];
      try {
        for (const r of ranges)
          await renderFrames(
            host,
            slug,
            r,
            (_i, png) => void hashes.push(createHash('sha256').update(png).digest('hex')),
          );
      } finally {
        await host.close();
      }
      return hashes;
    };
    const a = await pass();
    const b = await pass();
    const differing = a.flatMap((h, i) => (h === b[i] ? [] : [i]));
    expect(differing, 'frames that differ between two renders').toEqual([]);
  }, 600_000);
});

/** Moments that exercise each kind of content, from the resolved timeline. */
function sampleTimes(tl: Timeline): { t: number; what: string }[] {
  const tm = buildTimeMap(tl);
  const kind = (id: string) => tl.scenes.find((s) => s.id === id)?.kind;
  const explainer = tm.scenes.find((s) => kind(s.sceneId) === 'explainer')!;
  const first = tm.scenes[0]!;
  const last = tm.scenes.at(-1)!;
  const inbound = tl.transitions.find((x) => x.between[1] === explainer.sceneId)!;
  const outbound = tl.transitions.find((x) => x.between[0] === explainer.sceneId)!;
  const at = (t: number) => Math.round(t * 1000) / 1000;
  return [
    { t: at(first.start + 0.6), what: 'title card' },
    { t: at(1.75), what: 'click ripple and zoom' },
    { t: at(2.6), what: 'box, badge, captions' },
    { t: at(explainer.start - inbound.duration / 2), what: 'transition in' },
    { t: at(explainer.start + (explainer.end - explainer.start) / 2), what: 'explainer' },
    { t: at(explainer.end - outbound.duration / 2), what: 'transition out' },
    { t: at(last.start + 1.2), what: 'typing, callout, keystroke' },
    { t: at(last.end - 0.3), what: 'end of recording' },
  ];
}

/** The fixture: take, steps and automatic overlays, extra overlays, captions, an explainer. */
async function makeFixture(client: EngineClient, dir: string, slug: string): Promise<Timeline> {
  const take = 'take-1';
  const rel = `recordings/${take}`;
  await mkdir(path.join(dir, rel), { recursive: true });
  // Moving test pattern, encoded like the recorder (full-range, short GOP, B-frames).
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1920x1200:r=30:d=8',
    '-vf',
    'format=rgb24,format=yuvj420p',
    '-colorspace',
    'bt470bg',
    '-color_range',
    'pc',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-g',
    '15',
    '-keyint_min',
    '15',
    '-movflags',
    '+faststart',
    path.join(dir, rel, 'video.mp4'),
  ]);
  const events: RecorderEvent[] = [
    { kind: 'step-start', t: 0.2, stepId: 's1', title: 'Open the panel' },
    {
      kind: 'mouse',
      t: 0.3,
      points: [
        [0.3, 300, 300],
        [1.0, 700, 500],
        [1.5, 900, 600],
        [4.2, 650, 330],
      ],
    },
    {
      kind: 'click',
      t: 1.6,
      stepId: 's1',
      x: 900,
      y: 600,
      target: 'button "Open"',
      bbox: { x: 820, y: 570, w: 160, h: 60 },
    },
    { kind: 'step-end', t: 3.5, stepId: 's1' },
    { kind: 'step-start', t: 3.6, stepId: 's2', title: 'Name the service' },
    {
      kind: 'type',
      t: 4.5,
      stepId: 's2',
      text: 'orders',
      target: 'textbox "Name"',
      bbox: { x: 400, y: 300, w: 500, h: 50 },
    },
    { kind: 'key', t: 5.6, stepId: 's2', key: 'Enter' },
    { kind: 'step-end', t: 7.5, stepId: 's2' },
  ];
  await writeFile(
    path.join(dir, rel, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  await client.call('timeline.patch', {
    slug,
    patch: [
      {
        op: 'add',
        path: '/takes/-',
        value: {
          id: take,
          video: `${rel}/video.mp4`,
          events: `${rel}/events.jsonl`,
          width: 1920,
          height: 1200,
          fps: 30,
          duration: 8,
        },
      },
    ],
  });
  await client.call('timeline.rebuildFromTake', { slug });

  // An overlay written the way the agent writes them (compiled by the engine).
  await mkdir(path.join(dir, 'overlays'), { recursive: true });
  await writeFile(
    path.join(dir, 'overlays', 'Badge.tsx'),
    `import { z } from 'zod';
import { DomLayer, theme, useAnchor, useGsap, type OverlayMeta, type OverlayProps } from '@studio/overlay-sdk';

const Props = z.object({ text: z.string().default('New') });
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = { name: 'Badge', description: 'A pill above the anchored element.', props: Props };

export default function Badge({ props, duration }: OverlayProps<Props>) {
  const a = useAnchor();
  const scope = useGsap((tl) => {
    tl.from('.badge', { autoAlpha: 0, y: 12, duration: theme.duration.enter }).to('.badge', { autoAlpha: 0, duration: theme.duration.exit }, duration - theme.duration.exit);
  }, []);
  if (!a) return null;
  return (
    <DomLayer follow>
      <div ref={scope}>
        <div className="badge" style={{ position: 'absolute', left: a.x, top: a.y - 54, padding: '8px 16px', borderRadius: 999, background: theme.color.navy, color: '#fff', font: '600 20px Inter, sans-serif' }}>{props.text}</div>
      </div>
    </DomLayer>
  );
}
`,
  );
  const s1 = { stepId: 's1', target: 'primary' };
  const s2 = { stepId: 's2', target: 'primary' };
  const overlay = (
    id: string,
    component: string,
    start: number,
    end: number,
    extra: Record<string, unknown> = {},
  ) => ({
    op: 'add' as const,
    path: '/overlays/-',
    value: { id, component, start, end, props: {}, author: 'user', ...extra },
  });
  await client.call('timeline.patch', {
    slug,
    patch: [
      overlay('p-box', 'core:Box', 2, 3.4, { anchor: s1 }),
      overlay('p-badge', 'project:Badge', 2.1, 3.4, { anchor: s1, props: { text: 'Click here' } }),
      overlay('p-callout', 'core:Callout', 4.6, 6.4, {
        anchor: s2,
        props: { title: 'Service name', text: 'Name it orders' },
      }),
      overlay('p-keys', 'core:Keystroke', 4.8, 6.4, { props: { keys: ['⌘', 'Enter'] } }),
      {
        op: 'add',
        path: '/captions',
        value: [
          { id: 'c1', start: 0.3, end: 3.4, text: 'Open the panel first.' },
          { id: 'c2', start: 3.6, end: 7.4, text: 'Then name the service\norders and press Enter.' },
        ],
      },
    ],
  });
  // Captions need their overlay (the automatic one is added when there are cues).
  await client.call('timeline.rebuildFromTake', { slug });
  await client.call('scenes.insert', { slug, at: 3.55, component: 'core:BlueprintFlow', duration: 4 });
  return (await client.call('timeline.get', { slug })).timeline;
}
