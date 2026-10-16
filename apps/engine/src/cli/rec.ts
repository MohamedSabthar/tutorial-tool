/**
 * pnpm rec <project> [--dry]
 * Runs workspace/projects/<project>/script.spec.ts against WSO2 Integrator and, unless
 * --dry, saves a take. Uses the same code path as the app's Record button.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from '../projects';
import { runProjectScript } from '../recording';
import { Workspace } from '../workspace';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) {
  console.error('usage: pnpm rec <project> [--dry]');
  process.exit(2);
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const root = path.resolve(process.env.STUDIO_WORKSPACE ?? path.join(repo, 'workspace'));
const store = new ProjectStore(root);
const workspace = new Workspace(root);

const r = await runProjectScript(store, workspace, slug, args.includes('--dry') ? 'dry' : 'record', {
  onProgress: (m) => console.log(`· ${m}`),
  onEvent: (e) => {
    if (e.kind === 'step-start') console.log(`  ${e.stepId}  ${e.title}`);
  },
});
if (r.failure) {
  console.error(`✗ step ${r.failure.stepId} (${r.failure.title}): ${r.failure.error}`);
  process.exit(1);
}
const steps = r.events.filter((e) => e.kind === 'step-end').length;
console.log(`✓ ${steps} steps passed in ${(r.durationMs / 1000).toFixed(1)} s`);
if (r.take)
  console.log(
    `  take: workspace/projects/${slug}/${r.takePath} (${r.take.width}×${r.take.height}, ${r.take.fps} fps, ${r.take.duration.toFixed(1)} s)`,
  );
