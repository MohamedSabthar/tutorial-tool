/**
 * Builds Tutorial Studio as a macOS disk image (`pnpm dmg`).
 *
 *   1. checks the tools the build needs (macOS, Node 20.19+, pnpm, Rust, ffmpeg)
 *   2. builds the UI (`apps/desktop/dist`)
 *   3. stages the engine with its own Node runtime (`pnpm package:engine`)
 *   4. builds the app and the .dmg with Tauri (`--bundles app,dmg`)
 *
 * The DMG lands in apps/desktop/src-tauri/target/release/bundle/dmg/. It is built for this Mac's
 * architecture (the bundled Node runtime is the one running this script).
 *
 * Signing: ad-hoc by default (runs on any Mac of the same architecture after "Open Anyway").
 * With APPLE_SIGNING_IDENTITY (a Developer ID) the app and every executable in the engine
 * folder are signed with the hardened runtime; with APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID
 * too, Tauri notarizes it, so it opens on any Mac without warnings. Options:
 *   --skip-ui      reuse apps/desktop/dist
 *   --skip-engine  reuse apps/desktop/src-tauri/resources/engine
 *   --open         reveal the DMG in Finder when done
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const bundleDir = path.join(repo, 'apps/desktop/src-tauri/target/release/bundle');

const step = (msg) => console.log(`\n· ${msg}`);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

/** Runs a command in the repo, streaming its output; stops the build if it fails. */
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: repo, stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${r.status ?? r.signal}).`);
}

/** The first line a tool prints for `--version`, or null when it isn't installed. */
function versionOf(cmd, flag = '--version') {
  try {
    return execFileSync(cmd, [flag], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')[0]
      .trim();
  } catch {
    return null;
  }
}

step('Checking the tools');
if (process.platform !== 'darwin') fail('A .dmg can only be built on macOS.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19))
  fail(`Node 20.19 or later is needed (this is ${process.version}). Run "nvm use".`);
for (const [cmd, why] of [
  ['pnpm', 'install it with "corepack enable"'],
  ['cargo', 'install Rust from https://rustup.rs'],
]) {
  const v = versionOf(cmd);
  if (!v) fail(`${cmd} was not found: ${why}.`);
  console.log(`  ${cmd.padEnd(7)} ${v}`);
}
console.log(`  node    ${process.version} (${process.arch}; bundled into the app)`);
const ffmpeg = versionOf('ffmpeg', '-version');
console.log(
  ffmpeg
    ? `  ffmpeg  ${ffmpeg.split(' ').slice(0, 3).join(' ')}`
    : '  ffmpeg  not found: the build works, but the app needs it at runtime (brew install ffmpeg)',
);
console.log(
  process.env.APPLE_SIGNING_IDENTITY
    ? `  signing ${process.env.APPLE_SIGNING_IDENTITY}${process.env.APPLE_ID ? ' · notarizing' : ''}`
    : '  signing ad-hoc (set APPLE_SIGNING_IDENTITY to sign with a Developer ID; see README)',
);

if (!args.has('--skip-ui')) {
  step('Building the UI');
  run('pnpm', ['--filter', '@studio/desktop', 'build']);
}
if (!args.has('--skip-engine')) {
  step('Staging the engine (Node runtime, bundle, runtime packages)');
  run('pnpm', ['package:engine']);
}

// Tauri signs the app itself, not the executables in the engine folder. Notarization needs
// every one of them signed with the same identity and the hardened runtime.
const identity = process.env.APPLE_SIGNING_IDENTITY;
if (identity && identity !== '-') {
  step(`Signing the engine's executables (${identity})`);
  const engineDir = path.join(repo, 'apps/desktop/src-tauri/resources/engine');
  const entitlements = path.join(repo, 'apps/desktop/src-tauri/engine.entitlements');
  const machO = execFileSync(
    'find',
    [engineDir, '-type', 'f', '(', '-perm', '+111', '-o', '-name', '*.node', '-o', '-name', '*.dylib', ')'],
    {
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter((f) => f && execFileSync('file', ['-b', f], { encoding: 'utf8' }).startsWith('Mach-O'));
  for (const f of machO) {
    const executable = !f.endsWith('.node') && !f.endsWith('.dylib');
    run('codesign', [
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      ...(executable ? ['--entitlements', entitlements] : []),
      '--sign',
      identity,
      f,
    ]);
  }
  console.log(`  signed ${machO.length} files`);
}

step('Building the app and the disk image');
run('pnpm', [
  '--filter',
  '@studio/desktop',
  'tauri',
  'build',
  '--bundles',
  'app,dmg',
  '--config',
  'src-tauri/tauri.bundle.conf.json',
]);

const dmgDir = path.join(bundleDir, 'dmg');
const dmg = existsSync(dmgDir)
  ? readdirSync(dmgDir)
      .filter((f) => f.endsWith('.dmg'))
      .map((f) => path.join(dmgDir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  : undefined;
if (!dmg) fail(`The build finished but no .dmg was found in ${path.relative(repo, dmgDir)}.`);

const mb = (statSync(dmg).size / 1024 / 1024).toFixed(0);
console.log(`\n✓ ${path.relative(repo, dmg)} (${mb} MB)`);
console.log(`  App: ${path.relative(repo, path.join(bundleDir, 'macos', 'Tutorial Studio.app'))}`);
if (!identity || identity === '-')
  console.log(
    '  Ad-hoc signed, not notarized: on another Mac, open it with right-click → Open the first time\n' +
      '  (or System Settings → Privacy & Security → Open Anyway). See README for Developer ID signing.',
  );
else if (!process.env.APPLE_ID)
  console.log('  Signed but not notarized: set APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID to notarize.');
if (args.has('--open')) execFileSync('open', ['-R', dmg]);
