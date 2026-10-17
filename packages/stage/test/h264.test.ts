import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';
import { spsColor } from '../src/h264';

/** The avcC record of a short H.264 clip encoded with these ffmpeg output options. */
function avcC(opts: string[]): Uint8Array {
  const dir = mkdtempSync(path.join(tmpdir(), 'h264-'));
  const file = path.join(dir, 'clip.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=s=64x48:d=0.2',
    '-c:v',
    'libx264',
    ...opts,
    file,
  ]);
  const bytes = readFileSync(file);
  const mp4 = createFile();
  let out: Uint8Array | null = null;
  mp4.onReady = (info) => {
    const trak = mp4.getTrackById(info.videoTracks[0]!.id);
    const box = (trak.mdia.minf.stbl.stsd.entries[0] as unknown as { avcC: { write(s: DataStream): void } })
      .avcC;
    const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    box.write(s);
    out = new Uint8Array(s.buffer, 8);
  };
  mp4.appendBuffer(
    MP4BoxBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), 0),
    true,
  );
  mp4.flush();
  if (!out) throw new Error('no avcC');
  return out;
}

describe('spsColor', () => {
  it('reads full range and the colour description from the SPS', () => {
    expect(spsColor(avcC(['-pix_fmt', 'yuvj420p', '-colorspace', 'bt470bg']))).toEqual({
      fullRange: true,
      matrix: 'bt470bg',
    });
    expect(
      spsColor(
        avcC(['-pix_fmt', 'yuv420p', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709']),
      ),
    ).toEqual({ fullRange: false, primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' });
  });

  it('returns null without a VUI signal type', () => {
    expect(spsColor(avcC(['-pix_fmt', 'yuv420p']))).toBeNull();
    expect(spsColor(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
