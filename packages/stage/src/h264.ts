/**
 * The colour description in an H.264 stream's SPS (VUI video signal type). MP4s from ffmpeg
 * often carry it only there (no `colr` box), and Chromium's software decoder ignores it: a
 * full-range recording would be stretched as if it were limited range (light greys turn white).
 * Export passes this to the decoder as `colorSpace`.
 */
export interface SpsColor {
  fullRange: boolean;
  primaries?: VideoColorPrimaries;
  transfer?: VideoTransferCharacteristics;
  matrix?: VideoMatrixCoefficients;
}

const PRIMARIES: Record<number, VideoColorPrimaries> = {
  1: 'bt709',
  5: 'bt470bg',
  6: 'smpte170m',
};
const TRANSFER: Record<number, VideoTransferCharacteristics> = {
  1: 'bt709',
  6: 'smpte170m',
  13: 'iec61966-2-1',
};
const MATRIX: Record<number, VideoMatrixCoefficients> = {
  0: 'rgb',
  1: 'bt709',
  5: 'bt470bg',
  6: 'smpte170m',
};

/** Exp-Golomb bit reader over an RBSP (emulation prevention bytes removed). */
class Bits {
  private pos = 0;
  constructor(private b: Uint8Array) {}
  u(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.b[this.pos >> 3];
      if (byte === undefined) throw new Error('SPS ended early');
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) if (++zeros > 31) throw new Error('bad Exp-Golomb code');
    return 2 ** zeros - 1 + this.u(zeros);
  }
  se(): number {
    const k = this.ue();
    return k & 1 ? (k + 1) / 2 : -k / 2;
  }
}

function rbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    out.push(nal[i]!);
  }
  return new Uint8Array(out);
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/** The first SPS's colour description from an avcC record (the decoder `description`), or null. */
export function spsColor(avcC: Uint8Array): SpsColor | null {
  if (avcC.length < 8 || (avcC[5]! & 0x1f) === 0) return null;
  const len = (avcC[6]! << 8) | avcC[7]!;
  const r = new Bits(rbsp(avcC.subarray(8, 8 + len)));
  try {
    r.u(8); // NAL header
    const profile = r.u(8);
    r.u(16); // constraint flags, level
    r.ue(); // sps id
    if (HIGH_PROFILES.has(profile)) {
      const chroma = r.ue();
      if (chroma === 3) r.u(1);
      r.ue(); // bit depth luma
      r.ue(); // bit depth chroma
      r.u(1);
      if (r.u(1)) {
        for (let i = 0; i < (chroma === 3 ? 12 : 8); i++) {
          if (!r.u(1)) continue;
          let last = 8;
          let next = 8;
          for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
            if (next !== 0) next = (last + r.se() + 256) % 256;
            last = next === 0 ? last : next;
          }
        }
      }
    }
    r.ue(); // log2 max frame num
    const poc = r.ue();
    if (poc === 0) r.ue();
    else if (poc === 1) {
      r.u(1);
      r.se();
      r.se();
      for (let n = r.ue(); n > 0; n--) r.se();
    }
    r.ue(); // max ref frames
    r.u(1);
    r.ue(); // width in macroblocks
    r.ue(); // height in map units
    if (!r.u(1)) r.u(1); // frame_mbs_only, mb_adaptive_frame_field
    r.u(1);
    if (r.u(1)) for (let i = 0; i < 4; i++) r.ue(); // cropping
    if (!r.u(1)) return null; // no VUI
    if (r.u(1) && r.u(8) === 255) r.u(32); // aspect ratio
    if (r.u(1)) r.u(1); // overscan
    if (!r.u(1)) return null; // no video signal type
    r.u(3);
    const fullRange = r.u(1) === 1;
    const color: SpsColor = { fullRange };
    if (r.u(1)) {
      const p = PRIMARIES[r.u(8)];
      const t = TRANSFER[r.u(8)];
      const m = MATRIX[r.u(8)];
      if (p) color.primaries = p;
      if (t) color.transfer = t;
      if (m) color.matrix = m;
    }
    return color;
  } catch {
    return null;
  }
}
