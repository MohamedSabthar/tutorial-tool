/**
 * Stages the engine sidecar for the app bundle (`pnpm package:engine`, run by `pnpm package`).
 *
 * The engine needs real packages at runtime (Vite and esbuild compile overlays and scripts,
 * TypeScript and ESLint check them, Playwright drives the browsers, the agent SDK ships a native
 * Claude binary), so it ships as a folder rather than one executable:
 *
 *   resources/engine/
 *     node                          the Node runtime this script runs on
 *     apps/engine/dist/main.mjs     the engine, bundled (everything but the packages below)
 *     apps/engine/seed/             the workspace seed (skills, reference tutorial)
 *     apps/desktop/dist/            the built app, served to the render host
 *     packages/<name>/src/          package sources, for type-checking agent overlays
 *     node_modules/                 runtime packages and the overlay type-check's types
 *
 * The bundle sits at the same depth as apps/engine/src, so the engine's repo-relative paths
 * (seed, UI, packages) resolve inside this folder unchanged.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// esbuild is a dependency of the recorder (it bundles tutorial scripts), not of the repo root.
const { build } = createRequire(path.join(repo, 'packages/recorder/package.json'))('esbuild');
const out = path.join(repo, 'apps/desktop/src-tauri/resources/engine');

/** Packages the bundle loads at runtime instead of bundling (binaries, dynamic loading). */
const RUNTIME = {
  'apps/engine': [
    'playwright',
    '@anthropic-ai/claude-agent-sdk',
    'vite',
    'typescript',
    'eslint',
    'typescript-eslint',
  ],
  'packages/recorder': ['esbuild'],
};
/** Types and libraries the overlay type-check resolves (from the app's own dependencies). */
const OVERLAY_TYPES = {
  'apps/desktop': [
    'react',
    'react-dom',
    '@types/react',
    '@types/react-dom',
    'three',
    '@types/three',
    '@react-three/fiber',
    'gsap',
    'zod',
  ],
};

const step = (msg) => console.log(`· ${msg}`);

/** The installed version of `name` as seen from `dir` (a workspace package). */
function version(dir, name) {
  const pkg = realpathSync(path.join(repo, dir, 'node_modules', name));
  return JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
}

if (!existsSync(path.join(repo, 'apps/desktop/dist/index.html')))
  throw new Error('build the app first: pnpm --filter @studio/desktop build');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

step('bundling the engine');
const externals = [...Object.values(RUNTIME).flat(), 'playwright-core', 'fsevents'];
await build({
  entryPoints: [path.join(repo, 'apps/engine/src/main.ts')],
  outfile: path.join(out, 'apps/engine/dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: externals,
  // CommonJS dependencies inside an ES module bundle.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});

step('copying the seed, the built app and package sources');
cpSync(path.join(repo, 'apps/engine/seed'), path.join(out, 'apps/engine/seed'), { recursive: true });
cpSync(path.join(repo, 'apps/desktop/dist'), path.join(out, 'apps/desktop/dist'), { recursive: true });
for (const name of readdirSync(path.join(repo, 'packages'))) {
  const src = path.join(repo, 'packages', name, 'src');
  if (existsSync(src)) cpSync(src, path.join(out, 'packages', name, 'src'), { recursive: true });
}

step('installing runtime packages');
const deps = {};
for (const [dir, names] of Object.entries({ ...RUNTIME, ...OVERLAY_TYPES }))
  for (const name of names) deps[name] = version(dir, name);
// In a folder outside the repo: npm inside a pnpm workspace trips over the parent's layout.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'studio-engine-'));
const manifest =
  JSON.stringify(
    { name: 'tutorial-studio-engine', private: true, type: 'module', dependencies: deps },
    null,
    2,
  ) + '\n';
writeFileSync(path.join(tmp, 'package.json'), manifest);
// No bin links (the bundler copies files, not symlinks) and no install scripts (Playwright's
// browsers download on first run, into ~/.tutorial-studio). Peers are listed explicitly, so
// legacy peer resolution (npm 10's peer-set resolver crashes on this tree).
execFileSync(
  'npm',
  [
    'install',
    '--omit=dev',
    '--no-package-lock',
    '--no-bin-links',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--no-audit',
    '--no-fund',
  ],
  {
    cwd: tmp,
    stdio: 'inherit',
  },
);
// Claude Code is installed by the user, not shipped: drop the agent SDK's native binary package.
const scope = path.join(tmp, 'node_modules/@anthropic-ai');
for (const name of readdirSync(scope))
  if (name.startsWith('claude-agent-sdk-')) rmSync(path.join(scope, name), { recursive: true, force: true });
renameSync(path.join(tmp, 'node_modules'), path.join(out, 'node_modules'));
writeFileSync(path.join(out, 'package.json'), manifest);
rmSync(tmp, { recursive: true, force: true });

step(`copying the Node runtime (${process.version})`);
cpSync(process.execPath, path.join(out, 'node'));

const size = execFileSync('du', ['-sh', out]).toString().split('\t')[0];
step(`staged ${path.relative(repo, out)} (${size})`);
