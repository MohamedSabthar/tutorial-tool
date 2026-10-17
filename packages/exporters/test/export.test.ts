import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exportVideo,
  FrameEncoder,
  mixAudio,
  mixGraph,
  planChunks,
  resumableFrames,
  type RenderHost,
} from '../src/node';

const dir = mkdtempSync(path.join(tmpdir(), 'export-test-'));
const probe = (file: string, entries: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1', file], {
    encoding: 'utf8',
  });

describe('planChunks', () => {
  it('covers every frame once, in order', () => {
    const chunks = planChunks(1451, 30, 20);
    expect(chunks[0]!.from).toBe(0);
    expect(chunks.at(-1)!.to).toBe(1450);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.from).toBe(chunks[i - 1]!.to + 1);
    expect(chunks.length).toBe(20);
  });

  it('keeps chunks at least `min` frames long', () => {
    expect(planChunks(100, 30, 8)).toHaveLength(1);
    expect(planChunks(150, 30, 8).every((c) => c.to - c.from + 1 >= 60)).toBe(true);
    expect(planChunks(1, 30, 4)).toEqual([{ from: 0, to: 0, fps: 30 }]);
  });
});

describe('audio mix', () => {
  it('places clips sample-exactly and pads to the duration', () => {
    const { graph } = mixGraph(
      [
        { file: 'a.mp3', start: 0.5 },
        { file: 'b.mp3', start: 2 },
      ],
      5,
    );
    expect(graph).toContain('adelay=delays=24000S');
    expect(graph).toContain('adelay=delays=96000S');
    expect(graph).toContain('atrim=0:5.000000');
    expect(mixGraph([], 3).inputs).toContain('anullsrc=r=48000:cl=mono');
  });

  it('mixes a clip at its time, normalised to -16 LUFS', async () => {
    const tone = path.join(dir, 'tone.wav');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:d=1.5',
      '-af',
      'volume=-30dB',
      tone,
    ]);
    const out = path.join(dir, 'mix.m4a');
    await mixAudio([{ file: tone, start: 1.25 }], out, { duration: 4 });
    expect(Number(/duration=([\d.]+)/.exec(probe(out, 'format=duration'))![1])).toBeCloseTo(4, 1);
    const log = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-i', out, '-af', 'silencedetect=n=-50dB:d=0.1,ebur128', '-f', 'null', '-'],
      {
        encoding: 'utf8',
      },
    ).stderr;
    const onset = Number(/silence_end: ([\d.]+)/.exec(log)![1]);
    expect(Math.abs(onset - 1.25)).toBeLessThan(1 / 30);
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS\s+Threshold/.exec(log.slice(log.lastIndexOf('Summary')))![1]);
    expect(Math.abs(lufs - -16)).toBeLessThan(1);
  });

  it('makes a silent track when there is no voice-over', async () => {
    const out = path.join(dir, 'silent.m4a');
    await mixAudio([], out, { duration: 2 });
    expect(probe(out, 'stream=codec_name,sample_rate')).toContain('sample_rate=48000');
  });
});

describe('FrameEncoder', () => {
  it('encodes piped PNG frames to H.264 at the frame rate', async () => {
    const png = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=orange:s=320x180',
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-',
    ]);
    const out = path.join(dir, 'frames.mp4');
    const enc = await FrameEncoder.start(out, { fps: 30, codec: 'libx264' });
    for (let i = 0; i < 15; i++) await enc.write(png);
    await enc.finish();
    const info = probe(out, 'stream=codec_name,nb_frames,r_frame_rate,color_space');
    expect(info).toContain('codec_name=h264');
    expect(info).toContain('nb_frames=15');
    expect(info).toContain('r_frame_rate=30/1');
    expect(info).toContain('color_space=bt709');
  });
});

describe('exportVideo resume', () => {
  it('keeps finished chunks when cancelled and reuses them on the next export', async () => {
    const png = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=navy:s=160x90',
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-',
    ]);
    const rendered: number[] = [];
    const host = () =>
      ({
        frame: async (_slug: string, t: number) => {
          rendered.push(t);
          return { t, png, errors: {} };
        },
        close: async () => {},
      }) as unknown as RenderHost;
    const work = path.join(dir, 'work');
    const out = path.join(dir, 'resume.mp4');
    const base = {
      slug: 'p',
      duration: 4,
      fps: 30,
      out,
      work,
      host,
      audio: [],
      workers: 1,
      key: 'k1',
      encode: { codec: 'libx264' as const },
    };

    // Cancel once the first chunk (frames 0–59) is done.
    const abort = new AbortController();
    await expect(
      exportVideo({ ...base, signal: abort.signal, onProgress: (p) => p.frames >= 70 && abort.abort() }),
    ).rejects.toThrow('export cancelled');
    expect(await resumableFrames(work, 'k1')).toBe(60);
    expect(await resumableFrames(work, 'other')).toBe(0);

    rendered.length = 0;
    let resumed = 0;
    await exportVideo({ ...base, onProgress: (p) => (resumed = p.resumed) });
    expect(resumed).toBe(60);
    expect(rendered).toHaveLength(60);
    expect(probe(out, 'stream=nb_frames')).toContain('nb_frames=120');
    expect(await resumableFrames(work, 'k1')).toBe(0);
  });
});
