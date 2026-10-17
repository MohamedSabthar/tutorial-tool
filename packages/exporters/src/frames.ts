import type { RenderHost } from './host';

export interface FrameRange {
  /** First frame index (frame i is at output time i / fps). */
  from: number;
  /** Last frame index, inclusive. */
  to: number;
  fps: number;
}

/**
 * Renders output frames `from`–`to` in order through an export-mode host, handing each PNG to
 * `onFrame` (which may write or encode it; the next frame waits for it). Stops at the first
 * frame whose page reports an error, so a broken frame never reaches the video.
 */
export async function renderFrames(
  host: RenderHost,
  slug: string,
  range: FrameRange,
  onFrame: (index: number, png: Buffer) => Promise<void> | void,
): Promise<void> {
  for (let i = range.from; i <= range.to; i++) {
    const t = Math.round((i / range.fps) * 1e6) / 1e6;
    const { png, errors } = await host.frame(slug, t);
    const failed = Object.entries(errors);
    if (failed.length)
      throw new Error(`frame ${i} (${t.toFixed(3)} s): ${failed.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
    await onFrame(i, png);
  }
}
