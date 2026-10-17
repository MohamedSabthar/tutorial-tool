import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import type { z } from 'zod';
import { buildTimeMap, RpcError, type OverlayInstance, type Timeline } from '@studio/core';
import plugin, { determinismRules } from '@studio/overlay-sdk/eslint-plugin';
import type { OverlayServer } from './overlayServer';
import { registerSharedModules } from './agent/catalog';
import type { HeadlessStage } from './render';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Problem {
  stage: 'typecheck' | 'lint' | 'bundle' | 'render' | 'determinism';
  message: string;
  line?: number;
}

export interface CheckResult {
  ok: boolean;
  component: string;
  problems: Problem[];
  /** Output times rendered, in contact-sheet order. */
  frames: { t: number; label: string }[];
  /** JPEG contact sheet of the rendered frames (null when nothing rendered). */
  sheet: Buffer | null;
  /** PNG of the middle frame (library thumbnails). */
  middle: Buffer | null;
  /** The instance that was rendered, and whether it was a temporary test instance. */
  instance: { id: string; start: number; end: number; test: boolean } | null;
}

const run = (cmd: string, args: string[], cwd?: string) =>
  new Promise<{ code: number; out: string }>((resolve) =>
    execFile(cmd, args, { cwd, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
    ),
  );

/** `tsc --noEmit` on one overlay file, resolving packages the way the app does. */
export async function typecheckOverlay(file: string): Promise<Problem[]> {
  const dir = path.join(repo, 'node_modules', '.cache', 'studio-check');
  await mkdir(dir, { recursive: true });
  const config = path.join(
    dir,
    `tsconfig.${createHash('sha1').update(file).digest('hex').slice(0, 10)}.json`,
  );
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        jsx: 'react-jsx',
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        lib: ['es2022', 'dom', 'dom.iterable'],
        skipLibCheck: true,
        types: [],
        baseUrl: repo,
        paths: {
          '@studio/*': ['packages/*/src/index.ts'],
          '*': ['apps/desktop/node_modules/@types/*', 'apps/desktop/node_modules/*'],
        },
      },
      files: [file],
    }),
  );
  const tsc = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  const { code, out } = await run(process.execPath, [tsc, '-p', config]);
  if (code === 0) return [];
  const problems: Problem[] = [];
  let elsewhere = 0;
  for (const line of out.split('\n')) {
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/.exec(line.trim());
    if (!m) continue;
    if (path.resolve(repo, m[1]!) === file || path.resolve(m[1]!) === file)
      problems.push({ stage: 'typecheck', line: Number(m[2]), message: m[3]! });
    else elsewhere++;
  }
  if (!problems.length)
    problems.push({
      stage: 'typecheck',
      message: elsewhere ? `${elsewhere} type errors in imported files` : out.trim().slice(0, 500),
    });
  return problems;
}

let linter: ESLint | null = null;
/** The determinism rules (and nothing else) on one file. */
export async function lintOverlay(file: string): Promise<Problem[]> {
  linter ??= new ESLint({
    cwd: path.dirname(file),
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: { parser: tseslint.parser as never, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { studio: plugin },
        rules: determinismRules,
      },
    ],
  });
  const [res] = await linter.lintText(await readFile(file, 'utf8'), { filePath: file });
  return (res?.messages ?? []).map((m) => ({
    stage: 'lint' as const,
    line: m.line,
    message: `${m.ruleId ? `${m.ruleId}: ` : ''}${m.message}`,
  }));
}

/** Labels and output times to render for an instance: start, 25–75%, end, and just after. */
export function sampleTimes(start: number, end: number, duration: number) {
  const d = end - start;
  const at = (u: number) => Math.round((start + d * u) * 1000) / 1000;
  return [
    { t: at(0), label: 'start' },
    { t: at(0.25), label: '25%' },
    { t: at(0.5), label: '50%' },
    { t: at(0.75), label: '75%' },
    { t: Math.round((end - 0.04) * 1000) / 1000, label: 'end' },
    { t: Math.min(duration, Math.round((end + 0.3) * 1000) / 1000), label: 'exit' },
  ];
}

/** A grid of frames (3 per row, 640 px wide) with their labels, as one JPEG. */
async function contactSheet(frames: { png: Buffer; label: string }[]): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'studio-sheet-'));
  try {
    const font = [
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ].find((f) => existsSync(f));
    const inputs: string[] = [];
    const chains: string[] = [];
    for (const [i, f] of frames.entries()) {
      const p = path.join(dir, `${i}.png`);
      await writeFile(p, f.png);
      inputs.push('-i', p);
      const label = font
        ? `,drawbox=x=0:y=0:w=iw:h=34:color=0x13213B@0.85:t=fill,drawtext=fontfile=${font}:text='${f.label.replace(/[':%]/g, ' ')}':x=12:y=8:fontsize=20:fontcolor=white`
        : '';
      chains.push(`[${i}:v]scale=640:360${label}[f${i}]`);
    }
    const cols = Math.min(3, frames.length);
    const layout = frames.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|');
    const graph =
      frames.length === 1
        ? chains[0]!.replace('[f0]', '[out]')
        : `${chains.join(';')};${frames.map((_, i) => `[f${i}]`).join('')}xstack=inputs=${frames.length}:layout=${layout}:fill=white[out]`;
    const out = path.join(dir, 'sheet.jpg');
    const r = await run('ffmpeg', [
      '-v',
      'error',
      ...inputs,
      '-filter_complex',
      graph,
      '-map',
      '[out]',
      '-q:v',
      '4',
      out,
    ]);
    if (r.code !== 0) throw new Error(r.out);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * check_overlay: type-check, determinism lint, bundle, then render the component in the
 * project's timeline (its first instance, or a temporary test instance with default props on
 * the first step) at sample times, render one time twice to check determinism, and make a
 * contact sheet.
 */
export async function checkOverlay(opts: {
  workspace: string;
  slug: string;
  file: string;
  timeline: Timeline;
  overlays: OverlayServer;
  stage: Pick<HeadlessStage, 'render'>;
  times?: number[];
  instanceId?: string;
}): Promise<CheckResult> {
  let component: string;
  const problems: Problem[] = [];
  let mod: Record<string, unknown>;
  const ref = /^(core|workspace|project):([A-Za-z][A-Za-z0-9]*)$/.exec(opts.file);
  if (ref?.[1] === 'core') {
    // A built-in component: nothing to type-check or bundle; render it in place.
    await registerSharedModules();
    const { coreOverlays } = await import('@studio/overlays-core');
    const { coreScenes } = await import('@studio/scenes-core');
    const found = ({ ...coreOverlays, ...coreScenes } as unknown as Record<string, Record<string, unknown>>)[
      opts.file
    ];
    if (!found) throw new RpcError(`no core component ${opts.file}`, 'not_found');
    component = opts.file;
    mod = found;
  } else {
    const given = ref ? `overlays/${ref[2]}.tsx` : opts.file;
    const abs = path.resolve(opts.workspace, 'projects', opts.slug, given);
    const fromWorkspace = path.resolve(opts.workspace, given);
    const file = ref?.[1] === 'workspace' ? fromWorkspace : existsSync(abs) ? abs : fromWorkspace;
    if (!existsSync(file))
      throw new RpcError(`no file ${given} in the project or the workspace`, 'not_found');
    const rel = path.relative(opts.workspace, file).split(path.sep).join('/');
    const name = path.basename(file).replace(/\.(tsx|ts)$/, '');
    component = rel.startsWith('projects/') ? `project:${name}` : `workspace:${name}`;
    problems.push(...(await typecheckOverlay(file)), ...(await lintOverlay(file)));
    try {
      // Overlay modules read React, zod etc. from the shared registry (as in the app).
      await registerSharedModules();
      mod = await opts.overlays.load(rel);
      if (typeof mod.default !== 'function')
        throw new Error('the module has no default export (the component)');
    } catch (e) {
      problems.push({
        stage: 'bundle',
        message: e instanceof Error ? e.message.split('\n').slice(0, 6).join('\n') : String(e),
      });
      return { ok: false, component, problems, frames: [], sheet: null, middle: null, instance: null };
    }
  }

  // The instance to render: the requested one, the first that uses the component, or a test one.
  const tl = opts.timeline;
  const tm = buildTimeMap(tl);
  let instance = tl.overlays.find((o) =>
    opts.instanceId ? o.id === opts.instanceId : o.component === component,
  );
  let timeline = tl;
  let test = false;
  if (!instance) {
    const meta = (mod.meta ?? {}) as { props?: z.ZodType; defaultDuration?: number };
    const props = meta.props
      ? ((meta.props.safeParse({}).data as Record<string, unknown> | undefined) ?? {})
      : {};
    const step = tl.steps.find((s) => s.bbox) ?? tl.steps[0];
    const start = step ? (tm.toOutput(step.take, step.from)[0] ?? 0) + 0.5 : 0;
    const end = Math.min(tm.duration, start + (meta.defaultDuration ?? 3));
    instance = {
      id: 'check-instance',
      component,
      start,
      end: end > start ? end : start + 1,
      layer: 50,
      props,
      author: 'agent',
      ...(step?.bbox ? { anchor: { stepId: step.id, target: 'primary' } } : {}),
    } as OverlayInstance;
    timeline = { ...tl, overlays: [...tl.overlays, instance] };
    test = true;
  }
  const times = opts.times?.length
    ? opts.times.map((t) => ({ t, label: `t=${t}` }))
    : sampleTimes(instance.start, instance.end, tm.duration);

  const sendTimeline = test ? timeline : undefined;
  const frames = await opts.stage.render(
    opts.slug,
    times.map((x) => x.t),
    sendTimeline,
  );
  const seen = new Set<string>();
  for (const f of frames)
    for (const [id, message] of Object.entries(f.errors))
      if ((id === instance.id || id === component) && !seen.has(message)) {
        seen.add(message);
        problems.push({ stage: 'render', message: `at t=${f.t}: ${message}` });
      }
  // Determinism: the middle frame again, after the others.
  const mid = frames[Math.min(2, frames.length - 1)]!;
  const [again] = await opts.stage.render(opts.slug, [mid.t], sendTimeline);
  if (again && !again.png.equals(mid.png))
    problems.push({
      stage: 'determinism',
      message: `rendering t=${mid.t} twice gave different frames: the component depends on something besides time and props`,
    });
  const sheet = await contactSheet(
    frames.map((f, i) => ({ png: f.png, label: `${times[i]!.label}  ${f.t.toFixed(2)} s` })),
  );
  return {
    ok: problems.length === 0,
    component,
    problems,
    frames: times,
    sheet,
    middle: mid.png,
    instance: { id: instance.id, start: instance.start, end: instance.end, test },
  };
}
