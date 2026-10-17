import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { LibraryEntry, RpcError, type TimelinePatch } from '@studio/core';
import type { CheckResult } from './overlayCheck';
import type { SceneCheckResult } from './sceneCheck';
import type { OverlayServer } from './overlayServer';
import type { TimelineStore } from './timeline';
import { registerSharedModules } from './agent/catalog';

export type LibraryEntry = z.infer<typeof LibraryEntry>;

/** "name: type = default" lines from a props JSON Schema. */
export function propsSummary(schema: unknown): string[] {
  const s = schema as { properties?: Record<string, { type?: string; enum?: unknown[]; default?: unknown }> };
  return Object.entries(s?.properties ?? {}).map(([k, v]) => {
    const type = v.enum ? v.enum.map((x) => JSON.stringify(x)).join(' | ') : (v.type ?? 'any');
    return `${k}: ${type}${v.default !== undefined ? ` = ${JSON.stringify(v.default)}` : ''}`;
  });
}

/**
 * The shared overlay library in the workspace (`overlays/` with `index.json` and thumbnails).
 * Promoting moves a project component there so every tutorial can use it.
 */
type Kind = 'overlay' | 'scene';
const DIR: Record<Kind, string> = { overlay: 'overlays', scene: 'scenes' };

export class Library {
  constructor(
    private deps: {
      workspace: string;
      timelines: TimelineStore;
      overlays: () => Promise<OverlayServer>;
      check(slug: string, file: string): Promise<CheckResult>;
      /** Checks the explainer scene `sceneId` (scenes are checked in place in the timeline). */
      checkScene(slug: string, sceneId: string): Promise<SceneCheckResult>;
      commit(message: string, paths: string[]): Promise<string | null>;
    },
  ) {}

  private indexFile(kind: Kind) {
    return path.join(this.deps.workspace, DIR[kind], 'index.json');
  }

  /** The library's index: promoted overlays, then promoted scenes. */
  async index(): Promise<LibraryEntry[]> {
    const read = async (kind: Kind) => {
      try {
        return LibraryEntry.array().parse(JSON.parse(await readFile(this.indexFile(kind), 'utf8')));
      } catch {
        return [];
      }
    };
    return [...(await read('overlay')), ...(await read('scene'))];
  }

  thumbPath(name: string, kind: Kind = 'overlay'): string | null {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return null;
    const p = path.join(this.deps.workspace, DIR[kind], 'thumbs', `${name}.jpg`);
    return existsSync(p) ? p : null;
  }

  /**
   * Moves `project:Name` (an overlay in projects/<slug>/overlays or a scene in
   * projects/<slug>/scenes) into the shared library. It must pass its check first
   * (check_overlay, or check_scene on an explainer that uses it); a rendered frame becomes the
   * thumbnail, and this project's references switch to `workspace:Name`.
   */
  async promote(slug: string, id: string): Promise<LibraryEntry> {
    const m = /^project:([A-Za-z][A-Za-z0-9]*)$/.exec(id);
    if (!m) throw new RpcError('only project components (project:Name) can be promoted', 'bad_request');
    const name = m[1]!;
    const kind: Kind = existsSync(path.join(this.deps.workspace, `projects/${slug}/scenes/${name}.tsx`))
      ? 'scene'
      : 'overlay';
    const rel = `projects/${slug}/${DIR[kind]}/${name}.tsx`;
    const src = path.join(this.deps.workspace, rel);
    const destRel = `${DIR[kind]}/${name}.tsx`;
    const dest = path.join(this.deps.workspace, destRel);
    if (!existsSync(src)) throw new RpcError(`no ${rel}`, 'not_found');
    if (existsSync(dest))
      throw new RpcError(
        `the library already has ${kind === 'overlay' ? 'an overlay' : 'a scene'} named ${name}; rename this one first`,
        'bad_request',
      );
    const code = await readFile(src, 'utf8');
    if (/from\s+['"]\.\.?\//.test(code) || /import\s*\(\s*['"]\.\.?\//.test(code))
      throw new RpcError(`${name} imports files next to it; inline them before promoting it`, 'bad_request');

    // It must pass its check; a rendered frame becomes the thumbnail.
    const { timeline } = await this.deps.timelines.get(slug);
    let frame: Buffer | null;
    if (kind === 'overlay') {
      const check = await this.deps.check(slug, `overlays/${name}.tsx`);
      if (!check.ok)
        throw new RpcError(
          `${name} doesn't pass check_overlay yet: ${check.problems.map((p) => `[${p.stage}] ${p.message}`).join('; ')}`,
          'bad_request',
        );
      frame = check.middle;
    } else {
      const scene = timeline.scenes.find((s) => s.kind === 'explainer' && s.component === id);
      if (!scene)
        throw new RpcError(
          `use ${name} in an explainer of this tutorial first, so it can be checked`,
          'bad_request',
        );
      const check = await this.deps.checkScene(slug, scene.id);
      if (check.problems.length)
        throw new RpcError(
          `${name} doesn't pass check_scene yet: ${check.problems.map((p) => `[${p.stage}] ${p.message}`).join('; ')}`,
          'bad_request',
        );
      // A frame with the scene built up: the second beat (or the middle shot).
      frame =
        (check.frames.filter((f) => f.beat)[1] ?? check.frames[Math.floor(check.frames.length / 2)])?.png ??
        null;
    }
    let thumbnail: string | null = null;
    if (frame) {
      const thumbRel = `${DIR[kind]}/thumbs/${name}.jpg`;
      await mkdir(path.dirname(path.join(this.deps.workspace, thumbRel)), { recursive: true });
      await writeFile(path.join(this.deps.workspace, thumbRel), await toThumbnail(frame));
      thumbnail = thumbRel;
    }

    await mkdir(path.dirname(dest), { recursive: true });
    await rename(src, dest);

    // This project's instances (or explainer scenes) now use the shared component.
    const patch: TimelinePatch =
      kind === 'overlay'
        ? timeline.overlays.flatMap((o, i) =>
            o.component === id
              ? [{ op: 'replace' as const, path: `/overlays/${i}/component`, value: `workspace:${name}` }]
              : [],
          )
        : timeline.scenes.flatMap((sc, i) =>
            sc.kind === 'explainer' && sc.component === id
              ? [{ op: 'replace' as const, path: `/scenes/${i}/component`, value: `workspace:${name}` }]
              : [],
          );
    if (patch.length)
      await this.deps.timelines.patch(slug, patch, {
        author: 'user',
        label: `Promote ${name} to the library`,
      });

    await registerSharedModules();
    const mod = await (await this.deps.overlays()).load(destRel);
    const meta = (mod.meta ?? {}) as {
      name?: string;
      description?: string;
      props?: z.ZodType;
      beats?: string[];
    };
    let props: string[] = [];
    try {
      if (meta.props)
        props = propsSummary(z.toJSONSchema(meta.props, { io: 'input', unrepresentable: 'any' }));
    } catch {
      // Unrepresentable schema: no summary.
    }
    const entry = LibraryEntry.parse({
      id: `workspace:${name}`,
      kind,
      name: meta.name ?? name,
      description: meta.description ?? '',
      props,
      ...(meta.beats?.length ? { beats: meta.beats } : {}),
      thumbnail,
      from: slug,
      promotedAt: new Date().toISOString(),
    });
    const own = (await this.index()).filter((e) => e.kind === kind && e.id !== entry.id);
    await writeFile(this.indexFile(kind), JSON.stringify([...own, entry], null, 2) + '\n');
    await this.deps.commit(`library: promote ${name} from ${slug}`, [
      destRel,
      // The folder, not the moved file: git can't add a path that was never tracked.
      `projects/${slug}/${DIR[kind]}`,
      `${DIR[kind]}/index.json`,
      ...(thumbnail ? [thumbnail] : []),
      `projects/${slug}/tutorial.json`,
    ]);
    return entry;
  }
}

/** A 480 px wide JPEG of a frame. */
function toThumbnail(png: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'image2pipe',
        '-i',
        '-',
        '-vf',
        'scale=480:-2',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        '-q:v',
        '4',
        '-',
      ],
      { encoding: 'buffer', maxBuffer: 16 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr) || err.message)) : resolve(stdout)),
    );
    child.stdin?.end(png);
  });
}
