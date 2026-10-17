import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/projects';
import { TimelineStore } from '../src/timeline';
import { startOverlayServer, type OverlayServer } from '../src/overlayServer';
import { Library } from '../src/library';
import { Workspace } from '../src/workspace';
import type { CheckResult } from '../src/overlayCheck';

const BADGE = `import { z } from 'zod';
import { DomLayer, type OverlayMeta, type OverlayProps } from '@studio/overlay-sdk';
const Props = z.object({ label: z.string().default('New'), tone: z.enum(['orange', 'navy']).default('orange') });
type Props = z.infer<typeof Props>;
export const meta: OverlayMeta = { name: 'Badge', description: 'A small badge', props: Props };
export default function Badge({ props }: OverlayProps<Props>) { return <DomLayer>{props.label}</DomLayer>; }
`;

let ws: string;
let server: OverlayServer;
let store: ProjectStore;
let timelines: TimelineStore;
let slug: string;
let png: Buffer;
const checks: string[] = [];
let library: Library;

beforeAll(async () => {
  ws = await mkdtemp(path.join(os.tmpdir(), 'library-'));
  const workspace = new Workspace(ws);
  await workspace.init();
  store = new ProjectStore(ws);
  slug = (await store.create({ title: 'Lib', product: 'wso2-integrator' })).slug;
  await mkdir(path.join(store.dir(slug), 'overlays'), { recursive: true });
  await writeFile(path.join(store.dir(slug), 'overlays', 'Badge.tsx'), BADGE);
  await writeFile(
    path.join(store.dir(slug), 'overlays', 'Helper.tsx'),
    "import x from './x';\nexport default x;\n",
  );
  timelines = new TimelineStore(store, () => {});
  await timelines.patch(
    slug,
    [
      {
        op: 'add',
        path: '/overlays/-',
        value: { id: 'b1', component: 'project:Badge', start: 1, end: 2, props: { label: 'Hi' } },
      },
    ],
    { author: 'user' },
  );
  png = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=orange:s=640x360',
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    '-',
  ]);
  server = await startOverlayServer(ws, () => {});
  library = new Library({
    workspace: ws,
    timelines,
    overlays: async () => server,
    check: async (_slug, file): Promise<CheckResult> => {
      checks.push(file);
      return {
        ok: true,
        component: 'project:Badge',
        problems: [],
        frames: [],
        sheet: null,
        middle: png,
        instance: null,
      };
    },
    commit: (message, paths) => workspace.commit(message, paths),
  });
}, 30_000);
afterAll(async () => {
  await server.close();
  await rm(ws, { recursive: true, force: true });
});

describe('Library.promote', () => {
  it('moves a checked project component into the shared library and rewrites references', async () => {
    const entry = await library.promote(slug, 'project:Badge');
    expect(checks).toEqual(['overlays/Badge.tsx']);
    expect(entry).toMatchObject({
      id: 'workspace:Badge',
      name: 'Badge',
      description: 'A small badge',
      props: ['label: string = "New"', 'tone: "orange" | "navy" = "orange"'],
      thumbnail: 'overlays/thumbs/Badge.jpg',
      from: slug,
    });
    expect(existsSync(path.join(ws, 'overlays', 'Badge.tsx'))).toBe(true);
    expect(existsSync(path.join(store.dir(slug), 'overlays', 'Badge.tsx'))).toBe(false);
    expect((await readFile(path.join(ws, 'overlays', 'thumbs', 'Badge.jpg'))).subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8]),
    );
    expect((await timelines.get(slug)).timeline.overlays[0]!.component).toBe('workspace:Badge');
    expect(await library.index()).toHaveLength(1);
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ws, encoding: 'utf8' }).trim()).toBe(
      `library: promote Badge from ${slug}`,
    );
    // It is listed for every project now.
    expect((await server.list('another')).some((e) => e.id === 'workspace:Badge')).toBe(true);
  });

  it('promotes the only, never-committed component of a project', async () => {
    const other = (await store.create({ title: 'Fresh', product: 'wso2-integrator' })).slug;
    await mkdir(path.join(store.dir(other), 'overlays'), { recursive: true });
    await writeFile(
      path.join(store.dir(other), 'overlays', 'Tag.tsx'),
      BADGE.replace("name: 'Badge'", "name: 'Tag'"),
    );
    await expect(library.promote(other, 'project:Tag')).resolves.toMatchObject({ id: 'workspace:Tag' });
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ws, encoding: 'utf8' }).trim()).toBe(
      `library: promote Tag from ${other}`,
    );
  });

  it('refuses components with relative imports, name clashes and non-project ids', async () => {
    await expect(library.promote(slug, 'project:Helper')).rejects.toThrow(/imports files next to it/);
    await writeFile(path.join(store.dir(slug), 'overlays', 'Badge.tsx'), BADGE);
    await expect(library.promote(slug, 'project:Badge')).rejects.toThrow(
      /already has a component named Badge/,
    );
    await expect(library.promote(slug, 'workspace:Badge')).rejects.toThrow(/only project components/);
  });
});
