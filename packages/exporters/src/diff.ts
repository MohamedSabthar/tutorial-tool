import { execFile } from 'node:child_process';

/** Raw RGB24 pixels of a PNG, decoded with ffmpeg. */
function decode(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const child = execFile(
      'ffmpeg',
      ['-v', 'error', '-f', 'png_pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { encoding: 'buffer', maxBuffer: 64 << 20 },
      (err, stdout, stderr) =>
        err ? reject(new Error(String(stderr) || err.message)) : resolve({ data: stdout, width, height }),
    );
    child.stdin?.end(png);
  });
}

export interface FrameDiff {
  /** Mean absolute difference per channel, 0–255. */
  mean: number;
  /** Share of pixels where any channel differs by more than `threshold`. */
  changed: number;
  maxChannel: number;
}

/** How different two frames are (same size required). */
export async function diffFrames(a: Buffer, b: Buffer, threshold = 24): Promise<FrameDiff> {
  const [x, y] = await Promise.all([decode(a), decode(b)]);
  if (x.width !== y.width || x.height !== y.height)
    throw new Error(`frames differ in size: ${x.width}×${x.height} vs ${y.width}×${y.height}`);
  let sum = 0;
  let changed = 0;
  let max = 0;
  for (let i = 0; i < x.data.length; i += 3) {
    const dr = Math.abs(x.data[i]! - y.data[i]!);
    const dg = Math.abs(x.data[i + 1]! - y.data[i + 1]!);
    const db = Math.abs(x.data[i + 2]! - y.data[i + 2]!);
    sum += dr + dg + db;
    const m = Math.max(dr, dg, db);
    if (m > threshold) changed++;
    if (m > max) max = m;
  }
  const pixels = x.data.length / 3;
  return { mean: sum / (pixels * 3), changed: changed / pixels, maxChannel: max };
}
