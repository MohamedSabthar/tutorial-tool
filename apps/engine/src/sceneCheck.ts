import { buildTimeMap, resolveBeats, RpcError, type ExplainerScene, type Timeline } from '@studio/core';
import { contactSheet, lintOverlay, typecheckOverlay, type Problem } from './overlayCheck';
import type { OverlayServer } from './overlayServer';
import type { HeadlessStage } from './render';
import { registerSharedModules } from './agent/catalog';
import path from 'node:path';

export interface SceneCheckResult {
  ok: boolean;
  sceneId: string;
  component: string;
  problems: Problem[];
  /** Beat-to-narration alignment, one line per beat, plus warnings. */
  alignment: string[];
  voiced: boolean;
  /** Frames in contact-sheet order: label, output time, PNG, and the beat it shows (if any). */
  frames: { label: string; t: number; beat: string | null; png: Buffer }[];
  sheet: Buffer | null;
  span: { start: number; end: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * check_scene: the overlay checks for the scene's component file (type-check, determinism lint,
 * bundle), then frames rendered in the tutorial just after each beat (plus the start and the end),
 * a determinism re-render, and a report of how the beats line up with the narration.
 */
export async function checkScene(opts: {
  workspace: string;
  slug: string;
  sceneId: string;
  timeline: Timeline;
  overlays: OverlayServer;
  stage: Pick<HeadlessStage, 'render'>;
}): Promise<SceneCheckResult> {
  const tl = opts.timeline;
  const scene = tl.scenes.find((s): s is ExplainerScene => s.id === opts.sceneId && s.kind === 'explainer');
  if (!scene) throw new RpcError(`no explainer scene "${opts.sceneId}"`, 'not_found');
  const problems: Problem[] = [];

  // The component: built-in, or a file to check like an overlay.
  await registerSharedModules();
  let meta: { beats?: string[] } = {};
  if (scene.component.startsWith('core:')) {
    const { coreScenes } = await import('@studio/scenes-core');
    const mod = coreScenes[scene.component];
    if (!mod) problems.push({ stage: 'bundle', message: `no built-in scene ${scene.component}` });
    else meta = mod.meta ?? {};
  } else {
    const entry = (await opts.overlays.list(opts.slug)).find((e) => e.id === scene.component);
    if (!entry)
      problems.push({
        stage: 'bundle',
        message: `no scene component ${scene.component} (write scenes/<Name>.tsx)`,
      });
    else {
      const file = path.join(opts.workspace, entry.path);
      problems.push(...(await typecheckOverlay(file)), ...(await lintOverlay(file)));
      try {
        const mod = await opts.overlays.load(entry.path);
        if (typeof mod.default !== 'function')
          throw new Error('the module has no default export (the component)');
        meta = (mod.meta ?? {}) as { beats?: string[] };
      } catch (e) {
        problems.push({
          stage: 'bundle',
          message: e instanceof Error ? e.message.split('\n').slice(0, 6).join('\n') : String(e),
        });
      }
    }
  }

  const tm = buildTimeMap(tl);
  const span = tm.scenes.find((s) => s.sceneId === scene.id)!;
  const length = span.end - span.start;
  const voice = tl.voice.filter((v) => v.owner === scene.id);
  const timing = resolveBeats(scene, voice, meta.beats ?? []);

  // Alignment report.
  const alignment: string[] = [];
  const cues = scene.beats.length ? scene.beats : (meta.beats ?? []).map((id, i) => ({ id, at: `vo:${i}` }));
  for (const [i, id] of timing.order.entries()) {
    const at = timing.beats[id]!;
    const cue = cues.find((c) => c.id === id)?.at;
    const line = timing.lines.findIndex((l) => at >= l.start - 1e-3 && at <= l.end + 1e-3);
    const word = timing.words.find((w) => Math.abs(w.start - at) < 1e-3);
    let note = `beat ${id} at ${r2(at)} s`;
    if (line >= 0)
      note += ` (narration line ${line + 1}${word ? `, on "${word.w}"` : ''}: "${timing.lines[line]!.text}")`;
    alignment.push(note);
    if (typeof cue === 'string' && cue.startsWith('vo:') && !timing.lines[Number(cue.slice(3))])
      alignment.push(`  ⚠ ${id}: there is no narration line ${Number(cue.slice(3)) + 1}; add one per beat`);
    if (
      typeof cue === 'string' &&
      cue.startsWith('word:') &&
      !timing.words.some((w) => norm(w.w) === norm(cue.slice(5)))
    )
      alignment.push(`  ⚠ ${id}: the narration never says "${cue.slice(5)}"`);
    const next = timing.order[i + 1];
    if (next && timing.beats[next]! - at < 0.5)
      alignment.push(`  ⚠ ${id} and ${next} are less than 0.5 s apart`);
    if (at > length - 0.3) alignment.push(`  ⚠ ${id} fires after the scene ends (${r2(length)} s)`);
  }
  if (!timing.order.length) alignment.push('No beats: the component spreads its steps over the scene.');
  if (!timing.lines.length) alignment.push('⚠ No narration yet: write one narration line per beat.');

  // Frames: start, just after each beat (or 25/50/75% without beats), and the end.
  const shots: { label: string; local: number; beat: string | null }[] = [
    { label: 'start', local: 0.3, beat: null },
  ];
  if (timing.order.length)
    timing.order.forEach((id, i) => {
      const at = timing.beats[id]!;
      const next = timing.order[i + 1] ? timing.beats[timing.order[i + 1]!]! : length;
      shots.push({ label: id, local: Math.min(at + 0.7, at + (next - at) * 0.6), beat: id });
    });
  else for (const u of [0.25, 0.5, 0.75]) shots.push({ label: `${u * 100}%`, local: length * u, beat: null });
  shots.push({ label: 'end', local: Math.max(0, length - 0.3), beat: null });
  const times = shots.map((s) => r2(span.start + Math.min(Math.max(s.local, 0), length - 0.05)));
  const rendered = await opts.stage.render(opts.slug, times);
  for (const f of rendered)
    for (const [id, message] of Object.entries(f.errors))
      if (id === scene.id || id === scene.component)
        problems.push({ stage: 'render', message: `at t=${f.t}: ${message}` });
  const mid = rendered[Math.min(1, rendered.length - 1)]!;
  const [again] = await opts.stage.render(opts.slug, [mid.t]);
  if (again && !again.png.equals(mid.png))
    problems.push({ stage: 'determinism', message: `rendering t=${mid.t} twice gave different frames` });
  const frames = rendered.map((f, i) => ({
    label: shots[i]!.label,
    t: f.t,
    beat: shots[i]!.beat,
    png: f.png,
  }));
  const sheet = await contactSheet(
    frames.map((f) => ({ png: f.png, label: `${f.label}  ${(f.t - span.start).toFixed(2)} s` })),
  );
  const warned = alignment.some((l) => l.includes('⚠'));
  return {
    ok: problems.length === 0 && !warned,
    sceneId: scene.id,
    component: scene.component,
    problems,
    alignment,
    voiced: voice.length > 0,
    frames,
    sheet,
    span: { start: span.start, end: span.end },
  };
}
