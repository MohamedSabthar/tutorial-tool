import { execFile } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Annotation colours of the studio (steel blue for the target, orange for the pointer). */
const TARGET = '0x4F7AA3';
const POINTER = '0xFF5800';
const OUTLINE = '0x13213B';

export interface Mark {
  /** The target's box, CSS pixels in the window. */
  box: { x: number; y: number; w: number; h: number } | null;
  /** Where the pointer was, CSS pixels in the window. */
  point: { x: number; y: number } | null;
  /** The window's size in CSS pixels (the frame may be scaled down from it). */
  viewport: { width: number; height: number };
}

/** ffmpeg drawbox filters for a mark, in fractions of the frame so any frame size works. */
export function markFilters(m: Mark): string[] {
  const fx = (v: number) => (v / m.viewport.width).toFixed(5);
  const fy = (v: number) => (v / m.viewport.height).toFixed(5);
  const out: string[] = [];
  if (m.box) {
    const pad = 3;
    out.push(
      `drawbox=x=iw*${fx(m.box.x - pad)}:y=ih*${fy(m.box.y - pad)}:w=iw*${fx(m.box.w + 2 * pad)}:h=ih*${fy(m.box.h + 2 * pad)}:color=${TARGET}@0.95:t=4`,
    );
  }
  const p = m.point;
  if (p) {
    // A dark ring, a white ring and an orange dot: visible on light and dark screens.
    const ring = (r: number, color: string, t: string) =>
      `drawbox=x=iw*${fx(p.x)}-${r}:y=ih*${fy(p.y)}-${r}:w=${2 * r}:h=${2 * r}:color=${color}:t=${t}`;
    out.push(ring(14, `${OUTLINE}@0.9`, '3'), ring(11, 'white@0.95', '4'), ring(7, POINTER, 'fill'));
  }
  return out;
}

/**
 * Writes the frame from just before an action with its target boxed and the pointer marked.
 * Without ffmpeg (or nothing to mark) the plain frame is kept, so the agent still sees the screen.
 */
export async function writeMarkedShot(jpegBase64: string, out: string, mark: Mark): Promise<void> {
  const plain = `${out}.plain.jpg`;
  await writeFile(plain, Buffer.from(jpegBase64, 'base64'));
  const filters = markFilters(mark);
  try {
    if (!filters.length) throw new Error('nothing to mark');
    await run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      plain,
      '-vf',
      filters.join(','),
      '-q:v',
      '3',
      out,
    ]);
    await rm(plain, { force: true });
  } catch {
    await rm(out, { force: true });
    await rename(plain, out);
  }
}
