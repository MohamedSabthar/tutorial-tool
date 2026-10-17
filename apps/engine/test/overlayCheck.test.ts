import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lintOverlay, sampleTimes, typecheckOverlay } from '../src/overlayCheck';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'overlay-check-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const GOOD = `import { z } from 'zod';
import { DomLayer, useAnchor, useOverlayTime, type OverlayMeta, type OverlayProps } from '@studio/overlay-sdk';
const Props = z.object({ label: z.string().default('Create') });
type Props = z.infer<typeof Props>;
export const meta: OverlayMeta = { name: 'PointerArrow', description: 'An arrow at the target', props: Props };
export default function PointerArrow({ props }: OverlayProps<Props>) {
  const a = useAnchor();
  const { progress } = useOverlayTime();
  if (!a) return null;
  return <DomLayer follow><div style={{ position: 'absolute', left: a.x + a.w + 12, top: a.y, opacity: Math.min(1, progress * 4) }}>{props.label}</div></DomLayer>;
}
`;

describe('overlay checks', () => {
  it('passes a correct, time-driven overlay', async () => {
    const f = path.join(dir, 'PointerArrow.tsx');
    await writeFile(f, GOOD);
    expect(await typecheckOverlay(f)).toEqual([]);
    expect(await lintOverlay(f)).toEqual([]);
  }, 60_000);

  it('reports type errors and non-deterministic code with line numbers', async () => {
    const f = path.join(dir, 'Broken.tsx');
    await writeFile(
      f,
      GOOD.replace('const a = useAnchor();', 'const a = useAnchor();\n  const wobble: string = Date.now();'),
    );
    const types = await typecheckOverlay(f);
    expect(types[0]).toMatchObject({ stage: 'typecheck', line: 8 });
    expect(types[0]!.message).toMatch(/TS2322/);
    const lint = await lintOverlay(f);
    expect(lint).toEqual([
      expect.objectContaining({ stage: 'lint', line: 8, message: expect.stringMatching(/studio\/no-clock/) }),
    ]);
  }, 60_000);

  it('samples the instance and just after it', () => {
    expect(sampleTimes(10, 14, 30).map((s) => [s.label, s.t])).toEqual([
      ['start', 10],
      ['25%', 11],
      ['50%', 12],
      ['75%', 13],
      ['end', 13.96],
      ['exit', 14.3],
    ]);
  });
});
