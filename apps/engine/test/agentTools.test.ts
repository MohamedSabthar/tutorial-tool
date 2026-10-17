import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleTimeline } from '@studio/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ProjectStore } from '../src/projects';
import { TimelineStore } from '../src/timeline';
import { startOverlayServer, type OverlayServer } from '../src/overlayServer';
import { loadCatalog } from '../src/agent/catalog';
import type { ToolContext } from '../src/agent/tools/context';
import { timelineTools } from '../src/agent/tools/timeline';
import { projectTools } from '../src/agent/tools/project';
import { frameTools } from '../src/agent/tools/frames';
import { voTools } from '../src/agent/tools/vo';
import { Voiceover } from '../src/vo';
import { buildTimeMap, voiceSpans } from '@studio/core';

let ws: string;
let server: OverlayServer;
let ctx: ToolContext;
let store: ProjectStore;
let timelines: TimelineStore;
let run = 'agent-run-1';
let vo: Voiceover;
const ttsCalls: { text: string; previousText?: string; nextText?: string }[] = [];
const changes: { author: string }[] = [];

const CUSTOM = `import { z } from 'zod';
export const meta = {
  name: 'CodeCallout',
  description: 'A callout with code',
  props: z.object({ title: z.string(), code: z.string().default('') }),
};
export default function CodeCallout() { return null; }
`;

beforeAll(async () => {
  ws = await mkdtemp(path.join(os.tmpdir(), 'studio-tools-'));
  store = new ProjectStore(ws);
  const project = await store.create({ title: 'Tools test', product: 'wso2-integrator' });
  const dir = store.dir(project.slug);
  await writeFile(path.join(dir, 'tutorial.json'), JSON.stringify(sampleTimeline()));
  await mkdir(path.join(ws, 'overlays'), { recursive: true });
  await writeFile(path.join(ws, 'overlays', 'CodeCallout.tsx'), CUSTOM);
  // A 60 s take with recorder events for s3.
  await mkdir(path.join(dir, 'recordings', 'take-1'), { recursive: true });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=5:duration=60',
    '-pix_fmt',
    'yuv420p',
    path.join(dir, 'recordings', 'take-1', 'video.mp4'),
  ]);
  const events = [
    { kind: 'step-start', t: 30, stepId: 's3', title: 'Set the base path' },
    {
      kind: 'mouse',
      t: 31,
      points: [
        [31, 0, 0],
        [31.5, 50, 60],
        [32, 100, 120],
      ],
    },
    {
      kind: 'click',
      t: 32,
      stepId: 's3',
      target: 'textbox "Service Base Path"',
      x: 100,
      y: 120,
      bbox: { x: 80, y: 110, w: 200, h: 24 },
    },
    { kind: 'step-end', t: 45, stepId: 's3' },
  ];
  await writeFile(
    path.join(dir, 'recordings', 'take-1', 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  server = await startOverlayServer(ws, () => {});
  timelines = new TimelineStore(store, (e) => changes.push(e));
  ctx = {
    slug: project.slug,
    store,
    timelines,
    catalog: () => loadCatalog(server, project.slug),
    runId: () => run,
    runner: null as never,
    pipeline: null as never,
    voiceover: null as never,
    onTake: () => {},
  };
  // A fake ElevenLabs: a real 1.2 s MP3 (ffmpeg sine) and evenly spread character timings.
  ttsCalls.length = 0;
  ctx.voiceover = vo = new Voiceover({
    store,
    timelines,
    tts: {
      synthesize: async (slug, input) => {
        ttsCalls.push(input);
        const rel = `audio/${input.text.length}-${ttsCalls.length}.mp3`;
        await mkdir(path.join(store.dir(slug), 'audio'), { recursive: true });
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=1.2',
          path.join(store.dir(slug), rel),
        ]);
        const chars = [...input.text];
        const step = 1.2 / chars.length;
        return {
          hash: 'h',
          audio: rel,
          audioPath: '',
          duration: 1.2,
          cached: false,
          alignment: {
            chars,
            starts: chars.map((_, i) => i * step),
            ends: chars.map((_, i) => (i + 1) * step),
          },
        };
      },
    },
  });
}, 30000);

afterAll(async () => {
  await server.close();
  await rm(ws, { recursive: true, force: true });
});

const tools = () => [...timelineTools(ctx), ...projectTools(ctx), ...frameTools(ctx), ...voTools(ctx)];
async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  const t = tools().find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.handler(args as never, {});
}
const text = (r: CallToolResult) => (r.content.find((c) => c.type === 'text') as { text: string }).text;

describe('studio tools', () => {
  it('lists core, workspace and project components with prop schemas', async () => {
    const list = JSON.parse(text(await call('list_overlays', {}))) as {
      id: string;
      props: { properties?: object };
    }[];
    const ids = list.map((e) => e.id);
    expect(ids).toContain('core:TitleCard');
    expect(ids).toContain('workspace:CodeCallout');
    const custom = list.find((e) => e.id === 'workspace:CodeCallout')!;
    expect(Object.keys(custom.props.properties ?? {})).toEqual(['title', 'code']);
    const filtered = JSON.parse(text(await call('list_overlays', { query: 'TitleCard' }))) as {
      id: string;
    }[];
    expect(filtered.map((e) => e.id)).toEqual(['core:TitleCard']);
  });

  it('summarizes the timeline with output times and overlay indexes', async () => {
    const s = JSON.parse(text(await call('get_timeline', { detail: 'summary' })));
    expect(s.steps.map((x: { id: string }) => x.id)).toEqual(['s1', 's2', 's3']);
    expect(s.overlays.map((o: { index: number; id: string }) => [o.index, o.id])).toEqual([
      [0, 'ov-1'],
      [1, 'ov-2'],
    ]);
    const ranged = JSON.parse(text(await call('get_timeline', { from: 35, to: 50 })));
    expect(ranged.overlays.map((o: { id: string }) => o.id)).toEqual(['ov-2']);
  });

  it('applies a valid patch as the agent, grouped by run, and undo removes it', async () => {
    const r = await call('apply_timeline_patch', {
      patch: [
        {
          op: 'add',
          path: '/overlays/-',
          value: {
            id: 'ov-agent',
            component: 'core:TitleCard',
            start: 0,
            end: 3,
            props: { title: 'HTTP services' },
          },
        },
      ],
      label: 'Add title card',
    });
    expect(r.isError).toBeFalsy();
    const { timeline } = await timelines.get(ctx.slug);
    expect(timeline.overlays.at(-1)).toMatchObject({ id: 'ov-agent', author: 'agent' });
    expect(changes.at(-1)).toMatchObject({ author: 'agent' });
    // A second patch in the same run joins the same undo step.
    await call('apply_timeline_patch', {
      patch: [{ op: 'replace', path: '/overlays/2/end', value: 4 }],
    });
    await timelines.undo(ctx.slug);
    expect((await timelines.get(ctx.slug)).timeline.overlays.map((o) => o.id)).toEqual(['ov-1', 'ov-2']);
    run = 'agent-run-2';
  });

  it('rejects unknown components and bad props with a message the agent can act on', async () => {
    const unknown = await call('apply_timeline_patch', {
      patch: [
        { op: 'add', path: '/overlays/-', value: { id: 'x', component: 'core:Nope', start: 0, end: 1 } },
      ],
    });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/unknown component "core:Nope". Available: .*core:TitleCard/);
    const bad = await call('apply_timeline_patch', {
      patch: [
        {
          op: 'add',
          path: '/overlays/-',
          value: { id: 'y', component: 'workspace:CodeCallout', start: 0, end: 1, props: {} },
        },
      ],
    });
    expect(text(bad)).toMatch(/props for workspace:CodeCallout: .*title/);
    const pointer = await call('apply_timeline_patch', { patch: [{ op: 'remove', path: '/overlays/9' }] });
    expect(text(pointer)).toMatch(/Patch rejected/);
    expect((await timelines.get(ctx.slug)).timeline.overlays).toHaveLength(2);
  });

  it('returns one step’s recorder events with mouse paths condensed', async () => {
    const r = JSON.parse(text(await call('get_events', { stepId: 's3' })));
    expect(r.events.map((e: { kind: string }) => e.kind)).toEqual([
      'step-start',
      'mouse',
      'click',
      'step-end',
    ]);
    expect(r.events[1]).toMatchObject({ points: 3, from: [31, 0, 0], to: [32, 100, 120] });
    expect((await call('get_events', { stepId: 'zz' })).isError).toBe(true);
  });

  it('captures a recorded frame (optionally a region) and refuses explainer time', async () => {
    const r = await call('capture_frame', { t: 5 });
    const img = r.content.find((c) => c.type === 'image') as { data: string; mimeType: string };
    expect(img.mimeType).toBe('image/jpeg');
    expect(Buffer.from(img.data, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(text(r)).toMatch(/take-1 at 5 s/);
    const crop = await call('capture_frame', { t: 5, region: { x: 0, y: 0, w: 100, h: 50 } });
    expect(crop.isError).toBeFalsy();
    // sc-1 is 32 s; the explainer follows the 1 s transition.
    const explainer = await call('capture_frame', { t: 36 });
    expect(text(explainer)).toMatch(/explainer scene "sc-2"/);
  });

  it('voices step narration into timeline lines with word timings, and computes waveform peaks', async () => {
    const slug = ctx.slug;
    expect(text(await call('generate_voiceover'))).toMatch(/Choose a voice/);
    await store.saveBrief(slug, { ...(await store.readBrief(slug)), voice: 'voice-1' });
    await timelines.patch(
      slug,
      [
        { op: 'replace', path: '/steps/0/narration', value: 'Open the project.' },
        { op: 'replace', path: '/steps/1/narration', value: 'Add an HTTP service.' },
      ],
      { author: 'user' },
    );
    run = 'agent-run-vo';
    const r = JSON.parse(text(await call('generate_voiceover'))) as {
      lines: { stepId: string }[];
      skipped: { stepId: string }[];
    };
    expect(r.lines.map((l) => l.stepId)).toEqual(['s1', 's2']);
    expect(r.skipped).toEqual([{ stepId: 's3', reason: 'no narration' }]);
    expect(ttsCalls[0]).toMatchObject({ text: 'Open the project.', nextText: 'Add an HTTP service.' });
    expect(ttsCalls[1]).toMatchObject({ previousText: 'Open the project.' });

    const { timeline } = await timelines.get(slug);
    expect(timeline.voice.map((v) => [v.id, v.owner, v.start, v.duration])).toEqual([
      ['vo-s1', 's1', 0.25, 1.2],
      ['vo-s2', 's2', 0.25, 1.2],
    ]);
    expect(timeline.voice[1]!.words.map((w) => w.w)).toEqual(['Add', 'an', 'HTTP', 'service.']);
    const spans = voiceSpans(timeline, buildTimeMap(timeline));
    expect(spans.map((x) => x.start)).toEqual([0.25, 10.25]);

    // Redo one step: the other line stays.
    await call('generate_voiceover', { stepIds: ['s1'] });
    expect((await timelines.get(slug)).timeline.voice.map((v) => v.id).sort()).toEqual(['vo-s1', 'vo-s2']);
    expect((await call('generate_voiceover', { stepIds: ['s9'] })).isError).toBe(true);

    const peaks = await vo.peaks(slug, timeline.voice[0]!.audio!);
    expect(peaks.rate).toBe(50);
    expect(Math.abs(peaks.peaks.length - 60)).toBeLessThanOrEqual(3);
    expect(Math.max(...peaks.peaks)).toBeCloseTo(0.125, 1); // ffmpeg sine amplitude
    await expect(vo.peaks(slug, '../tutorial.json')).rejects.toThrow(/audio/);
  });
});
