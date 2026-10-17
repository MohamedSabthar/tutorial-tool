import { advance } from '@react-three/fiber';
import { FrameProvider } from './frameProvider';

/**
 * Export drives the stage one output frame at a time: the page sets the stage time, then awaits
 * `exportFrameReady()` before the host captures. In export mode the canvas never renders on its
 * own (frameloop "never"); this draws it once everything for the frame is in place:
 *   1. every canvas has committed the new render (canvases commit in their own React root)
 *   2. the recorded frames are decoded and on their textures
 *   3. fonts and images are loaded
 *   4. advance() draws the canvases
 */

/** Work a frame waits on (decoding the recorded frame, loading a provider). */
const pending = new Set<Promise<unknown>>();

/** Makes the current export frame wait for `p`. */
export function trackPending<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  const done = () => void pending.delete(p);
  p.then(done, done);
  return p;
}

/** The mounted canvases by mount id: how many times each committed, and the stage time it last committed. */
const commits = new Map<number, { n: number; t: number | null }>();
let nextCanvas = 1;

/** A mounted canvas: call `commit(t)` after each of its commits, `dispose()` on unmount. */
export function registerCanvas(): { commit(t: number): void; dispose(): void } {
  const id = nextCanvas++;
  commits.set(id, { n: 0, t: null });
  return {
    commit: (t) => void commits.set(id, { n: (commits.get(id)?.n ?? 0) + 1, t }),
    dispose: () => void commits.delete(id),
  };
}

/** The canvases' commit counts now (call before asking React to render the next frame). */
export const canvasCommits = (): Map<number, number> => new Map([...commits].map(([id, c]) => [id, c.n]));

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/**
 * Resolves once the frame at stage time `t`, requested after `before` (from `canvasCommits()`),
 * is ready and the canvases have drawn it. Errors from decoding reject.
 */
export async function exportFrameReady(
  t: number,
  before: Map<number, number>,
  timeoutMs = 10_000,
): Promise<void> {
  const until = performance.now() + timeoutMs;
  // 1. Every canvas has committed since the request, at time t (a commit for another reason,
  //    e.g. an overlay finishing loading, may come in between and must not count).
  const committed = () => [...commits].every(([id, c]) => c.n > (before.get(id) ?? 0) && c.t === t);
  while (!committed()) {
    if (performance.now() > until) throw new Error(`the stage did not render ${t.toFixed(3)} s in time`);
    await nextFrame();
  }
  // 2. Decoded frames (work started by those commits, and anything it starts).
  while (pending.size) {
    if (performance.now() > until)
      throw new Error(`the recorded frame for ${t.toFixed(3)} s did not decode in time`);
    await Promise.all([...pending]);
  }
  // 3. Fonts and images.
  await document.fonts.ready;
  await Promise.all(
    [...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))),
  );
  // 4. Draw.
  advance(performance.now());
}

const providers = new Map<string, Promise<FrameProvider>>();

/** The shared frame provider for a recording URL (opened once per page). */
export function frameProvider(src: string): Promise<FrameProvider> {
  let p = providers.get(src);
  if (!p) {
    p = FrameProvider.open(src);
    providers.set(src, p);
    p.catch(() => providers.delete(src));
  }
  return p;
}
