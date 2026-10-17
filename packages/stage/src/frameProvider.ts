import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample } from 'mp4box';
import { spsColor } from './h264';

/** A demuxed sample, times in seconds. */
interface Chunk {
  /** Presentation time. */
  cts: number;
  dts: number;
  duration: number;
  key: boolean;
  data: Uint8Array;
}

/**
 * Exact recorded frames for export: the take's MP4 demuxed with mp4box.js and decoded with
 * WebCodecs, one group of pictures (GOP, keyframe to keyframe, 0.5 s in our takes) at a time.
 * `frameAt(t)` returns the frame shown at take time t, the same frame every time, so export is
 * frame exact where a seeking <video> is only close. Export renders forward, so each GOP is
 * decoded once.
 */
export class FrameProvider {
  /** Chunks in decode order; GOPs start at the key chunks. */
  private chunks: Chunk[];
  /** Presentation times, ascending, with the decode-order index of each. */
  private shown: { cts: number; i: number }[];
  private gop: { start: number; frames: Map<number, VideoFrame> } | null = null;
  private decoding: Promise<void> | null = null;

  private constructor(
    private config: VideoDecoderConfig,
    chunks: Chunk[],
    readonly width: number,
    readonly height: number,
  ) {
    this.chunks = chunks;
    this.shown = chunks.map((c, i) => ({ cts: c.cts, i })).sort((a, b) => a.cts - b.cts);
  }

  static async open(url: string): Promise<FrameProvider> {
    if (typeof VideoDecoder === 'undefined') throw new Error('WebCodecs is not available here');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not load the recording (${res.status})`);
    const buf = MP4BoxBuffer.fromArrayBuffer(await res.arrayBuffer(), 0);
    const { config, chunks, width, height } = await demux(buf);
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`this browser can't decode ${config.codec}`);
    return new FrameProvider(config, chunks, width, height);
  }

  /** Take duration covered by frames (seconds). */
  get duration(): number {
    const last = this.shown.at(-1);
    return last ? last.cts + this.chunks[last.i]!.duration : 0;
  }

  /** The frame on screen at take time `t` (owned by the provider: draw it, don't close it). */
  async frameAt(t: number): Promise<VideoFrame> {
    // The last frame presented at or before t (a hair of slack for float times).
    let lo = 0;
    let hi = this.shown.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.shown[mid]!.cts <= t + 1e-4) lo = mid;
      else hi = mid - 1;
    }
    const target = this.shown[lo]!;
    let start = target.i;
    while (start > 0 && !this.chunks[start]!.key) start--;
    while (this.decoding) await this.decoding;
    if (this.gop?.start !== start) {
      this.decoding = this.decodeGop(start);
      try {
        await this.decoding;
      } finally {
        this.decoding = null;
      }
    }
    const frame = this.gop!.frames.get(Math.round(target.cts * 1e6));
    if (!frame) throw new Error(`no decoded frame at ${target.cts.toFixed(3)} s`);
    return frame;
  }

  private async decodeGop(start: number) {
    this.release();
    const frames = new Map<number, VideoFrame>();
    let failure: Error | null = null;
    const decoder = new VideoDecoder({
      output: (f) => frames.set(f.timestamp, f),
      error: (e) => (failure = e instanceof Error ? e : new Error(String(e))),
    });
    decoder.configure(this.config);
    for (let i = start; i < this.chunks.length && (i === start || !this.chunks[i]!.key); i++) {
      const c = this.chunks[i]!;
      decoder.decode(
        new EncodedVideoChunk({
          type: c.key ? 'key' : 'delta',
          timestamp: Math.round(c.cts * 1e6),
          duration: Math.round(c.duration * 1e6),
          data: c.data,
        }),
      );
    }
    await decoder.flush();
    decoder.close();
    if (failure) {
      for (const f of frames.values()) f.close();
      throw failure;
    }
    this.gop = { start, frames };
  }

  private release() {
    for (const f of this.gop?.frames.values() ?? []) f.close();
    this.gop = null;
  }

  close() {
    this.release();
  }
}

/** The first video track's decoder config and samples. */
function demux(
  buf: MP4BoxBuffer,
): Promise<{ config: VideoDecoderConfig; chunks: Chunk[]; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const file = createFile();
    let samples: Sample[] = [];
    let expected = 0;
    let meta: {
      config: VideoDecoderConfig;
      timescale: number;
      /** Media time shown at 0 (the edit list's start: B-frames delay presentation by a few frames). */
      offset: number;
      width: number;
      height: number;
    } | null = null;
    const finish = () => {
      if (!meta || samples.length < expected) return;
      const { timescale } = meta;
      const offset = meta.offset >= 0 ? meta.offset : Math.min(...samples.map((s) => s.cts));
      resolve({
        config: meta.config,
        width: meta.width,
        height: meta.height,
        chunks: samples.map((s) => ({
          cts: (s.cts - offset) / timescale,
          dts: (s.dts - offset) / timescale,
          duration: s.duration / timescale,
          key: s.is_sync,
          data: s.data!,
        })),
      });
    };
    file.onError = (_module: string, message: string) => reject(new Error(message));
    file.onReady = (info) => {
      const track = info.videoTracks[0];
      if (!track) return reject(new Error('the recording has no video track'));
      const trak = file.getTrackById(track.id);
      let description: Uint8Array | undefined;
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        const box = (entry as { avcC?: { write(s: DataStream): void } }).avcC;
        if (box) {
          const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
          box.write(stream);
          description = new Uint8Array(stream.buffer, 8); // without the box header
        }
      }
      const colorSpace = description ? spsColor(description) : null;
      meta = {
        config: {
          codec: track.codec,
          codedWidth: track.video!.width,
          codedHeight: track.video!.height,
          ...(description ? { description } : {}),
          // The SPS's colour description (often the only one in the file; the software decoder ignores it).
          ...(colorSpace ? { colorSpace } : {}),
          // Software decode is bit-exact across runs; export needs the same frame every time.
          hardwareAcceleration: 'prefer-software',
        },
        timescale: track.timescale,
        offset: Number(
          (trak as { edts?: { elst?: { entries?: { media_time: number }[] } } }).edts?.elst?.entries?.find(
            (e) => e.media_time >= 0,
          )?.media_time ?? -1,
        ),
        width: track.video!.width,
        height: track.video!.height,
      };
      expected = track.nb_samples;
      file.setExtractionOptions(track.id, null, { nbSamples: expected });
      file.start();
    };
    file.onSamples = (_id, _user, batch) => {
      samples = samples.concat(batch);
      finish();
    };
    file.appendBuffer(buf, true);
    file.flush();
  });
}
