import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimeMap, sampleTimeline, type Timeline } from '@studio/core';
import { DocWriter, instructionRequest, stillTime, stillTimeline } from '../src/docs';

const tl = (): Timeline => {
  const t = sampleTimeline();
  t.steps = t.steps.map((s, i) => ({
    ...s,
    narration: `Narration ${i + 1}.`,
    bbox: { x: 10, y: 10, w: 50, h: 20 },
  }));
  return t;
};

/** A DocWriter over a temp folder and a fixed timeline; `send` decides what the agent does. */
function writer(send: (w: DocWriter, slug: string, text: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'docs-'));
  const timeline = tl();
  const sent: string[] = [];
  const w: DocWriter = new DocWriter({
    store: { dir: () => dir } as never,
    timelines: { get: async () => ({ timeline }) } as never,
    send: async (slug, text) => {
      sent.push(text);
      await send(w, slug, text);
    },
    render: async () => Buffer.alloc(0),
    agentTimeoutMs: 200,
  });
  return { w, timeline, sent };
}

describe('doc instructions', () => {
  it('asks the agent once, then reuses the saved rewrites while the narration is unchanged', async () => {
    const { w, timeline, sent } = writer(async (self, slug) => {
      setTimeout(
        () =>
          void self.save(
            slug,
            timeline.steps.map((s) => ({ stepId: s.id, instruction: `Do ${s.id}.` })),
          ),
        10,
      );
    });
    const first = await w.instructions('p', timeline.steps);
    expect(first.note).toBeUndefined();
    expect(first.text[timeline.steps[0]!.id]).toBe(`Do ${timeline.steps[0]!.id}.`);
    expect(sent).toHaveLength(1);
    await w.instructions('p', timeline.steps);
    expect(sent).toHaveLength(1);
    // An edited narration is asked for again (only that step).
    timeline.steps[0]!.narration = 'New words.';
    await w.instructions('p', timeline.steps);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain(`"stepId": "${timeline.steps[0]!.id}"`);
    expect(sent[1]).not.toContain(`"stepId": "${timeline.steps[1]!.id}"`);
  });

  it('falls back to the narration when the agent is unavailable or silent', async () => {
    const down = writer(async () => {
      throw new Error('no agent');
    });
    const r = await down.w.instructions('p', down.timeline.steps);
    expect(r.text[down.timeline.steps[0]!.id]).toBe('Narration 1.');
    expect(r.note).toMatch(/no agent/);
    const silent = writer(async () => {});
    expect((await silent.w.instructions('p', silent.timeline.steps)).note).toMatch(/in time/);
  });

  it('asks with every step as JSON', () => {
    const msg = instructionRequest(tl().steps.slice(0, 1));
    expect(msg).toContain('save_doc_instructions');
    expect(msg).toContain('"narration": "Narration 1."');
  });
});

describe('doc stills', () => {
  it('times a still just before the step action', () => {
    const t = tl();
    const step = t.steps[0]!;
    const tm = buildTimeMap(t);
    const at = step.from + 1;
    const time = stillTime(t, tm, step, [
      { kind: 'click', t: at, stepId: step.id, x: 0, y: 0, target: 'x', bbox: { x: 0, y: 0, w: 1, h: 1 } },
    ]);
    expect(time).toBeCloseTo(tm.toOutput(step.take, at - 0.3)[0]!, 3);
    expect(stillTime(t, tm, step, [])).not.toBeNull();
  });

  it('boxes the target and hides captions', () => {
    const t = tl();
    t.overlays.push({
      id: 'cap',
      component: 'core:Captions',
      start: 0,
      end: 5,
      layer: 10,
      props: {},
      author: 'auto',
    });
    const s = stillTimeline(t, t.steps[0]!, 2);
    expect(s.overlays.some((o) => o.component === 'core:Captions')).toBe(false);
    const box = s.overlays.find((o) => o.id === 'doc-still-box')!;
    expect(box).toMatchObject({
      component: 'core:Box',
      start: 1,
      end: 3,
      anchor: { stepId: t.steps[0]!.id },
    });
  });
});
