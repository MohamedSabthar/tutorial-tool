import { describe, expect, it } from 'vitest';
import { outlineChanges, scriptOutline } from '../src/pipeline/scriptOutline';

const before = `
await tut.step('s1', 'Open', async () => {
  tut.cue('Add');
  await openArtifacts(ctx);
  await tut.hold(800);
});
await tut.step('s2', "Create", async () => {
  await tut.click(create, { description: 'Create', cue: 'Create' });
  await tut.hold(1000);
});`;

describe('script outline', () => {
  it("reads each step's cues and holds, and says what changed", () => {
    expect(scriptOutline(before)).toEqual({
      s1: { cues: ['Add'], holdMs: 800 },
      s2: { cues: ['Create'], holdMs: 1000 },
    });
    const after = before
      .replace("cue: 'Create'", "cue: 'service'")
      .replace('tut.hold(1000)', 'tut.hold(2200)');
    expect(outlineChanges(scriptOutline(before), scriptOutline(after))).toBe(
      's2 cues Create → service; s2 holds +1.2 s',
    );
    expect(outlineChanges(scriptOutline(before), scriptOutline(before))).toBeNull();
  });
});
