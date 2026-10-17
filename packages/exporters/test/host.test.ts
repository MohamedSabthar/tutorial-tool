import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { diffFrames, isHardwareRenderer } from '../src/node';

/** A solid-colour PNG made by ffmpeg. */
const solid = (color: string, size = '32x18') =>
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=${size}`,
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    '-',
  ]);

describe('render host', () => {
  it('tells GPU renderers from software ones', () => {
    expect(isHardwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)')).toBe(
      true,
    );
    expect(
      isHardwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'),
    ).toBe(false);
    expect(isHardwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(false);
    expect(isHardwareRenderer('Microsoft Basic Render Driver')).toBe(false);
    expect(isHardwareRenderer('no WebGL')).toBe(false);
  });

  it('diffs frames', async () => {
    const white = solid('white');
    expect(await diffFrames(white, solid('white'))).toEqual({ mean: 0, changed: 0, maxChannel: 0 });
    const d = await diffFrames(white, solid('black'));
    expect(d.mean).toBeGreaterThan(250);
    expect(d.changed).toBe(1);
    await expect(diffFrames(white, solid('white', '16x9'))).rejects.toThrow(/differ in size/);
  });
});
