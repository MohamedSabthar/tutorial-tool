import { execFile, spawn, type ChildProcess } from 'node:child_process';

export interface EncodeOptions {
  fps: number;
  /** Target video bitrate, e.g. "12M". */
  bitrate?: string;
  /** Video encoder; default: the hardware one when ffmpeg has it (`hardwareEncoder()`). */
  codec?: 'h264_videotoolbox' | 'libx264';
}

let hardware: Promise<boolean> | null = null;

/** Whether this ffmpeg has VideoToolbox H.264 (macOS hardware encode). */
export function hardwareEncoder(): Promise<boolean> {
  hardware ??= new Promise((resolve) =>
    execFile('ffmpeg', ['-hide_banner', '-encoders'], (err, stdout) =>
      resolve(!err && /\bh264_videotoolbox\b/.test(stdout)),
    ),
  );
  return hardware;
}

/** ffmpeg arguments for the video stream: H.264 in BT.709 limited range, no B-frames (clean concat). */
export function videoArgs(
  codec: NonNullable<EncodeOptions['codec']>,
  fps: number,
  bitrate: string,
): string[] {
  const enc =
    codec === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', bitrate, '-profile:v', 'high', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate];
  return [
    // Screenshots are sRGB; tag and convert them as BT.709 so players show the same colours.
    '-vf',
    'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    ...enc,
    '-bf',
    '0',
    '-g',
    String(fps * 2),
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
  ];
}

/**
 * Encodes PNG frames piped in order into an H.264 MP4 (video only): `write()` each frame, then
 * `finish()`. Writes wait when ffmpeg falls behind.
 */
export class FrameEncoder {
  private child: ChildProcess;
  private exited: Promise<void>;
  private stderr = '';

  private constructor(child: ChildProcess) {
    this.child = child;
    child.stderr?.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    this.exited = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) =>
        code === 0
          ? resolve()
          : reject(
              new Error(`ffmpeg failed (${signal ?? code}): ${this.stderr.trim().split('\n').pop() ?? ''}`),
            ),
      );
    });
    this.exited.catch(() => {});
  }

  static async start(out: string, opts: EncodeOptions): Promise<FrameEncoder> {
    const codec = opts.codec ?? ((await hardwareEncoder()) ? 'h264_videotoolbox' : 'libx264');
    const args = [
      '-v',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      '-framerate',
      String(opts.fps),
      '-i',
      '-',
      ...videoArgs(codec, opts.fps, opts.bitrate ?? '12M'),
      '-an',
      '-movflags',
      '+faststart',
      out,
    ];
    return new FrameEncoder(spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] }));
  }

  async write(png: Buffer): Promise<void> {
    const stdin = this.child.stdin!;
    if (stdin.write(png)) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        stdin.off('drain', done);
        this.child.off('close', fail);
        resolve();
      };
      const fail = () => reject(new Error(`ffmpeg stopped: ${this.stderr.trim()}`));
      stdin.once('drain', done);
      this.child.once('close', fail);
    });
  }

  async finish(): Promise<void> {
    this.child.stdin!.end();
    await this.exited;
  }

  kill() {
    this.child.stdin?.destroy();
    this.child.kill('SIGKILL');
  }
}

/** Runs ffmpeg to completion; rejects with its last error line. */
export function ffmpeg(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      ['-hide_banner', ...args],
      { maxBuffer: 32 << 20, signal },
      (err, _stdout, stderr) => {
        if (err)
          reject(new Error(`ffmpeg failed: ${String(stderr).trim().split('\n').pop() ?? err.message}`));
        else resolve(String(stderr));
      },
    );
    child.stdin?.end();
  });
}
