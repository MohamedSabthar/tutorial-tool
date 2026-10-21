import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScript, runTutorial } from '@studio/recorder/node';
import { SEED_DIR } from '../src/workspace';

/**
 * Recorder regression (`pnpm test:recorder`): the seeded reference tutorial (demo-http) dry-runs
 * in the real product. It opens product windows (and downloads the pinned VS Code on first run),
 * so it only runs on demand. A failure here means the UI changed under the seed skill's page
 * objects: the failing step, error and ARIA snapshot say where.
 */
const SCRIPT = path.join(SEED_DIR, 'projects', 'demo-http', 'script.spec.ts');

describe.runIf(process.env.STUDIO_E2E)('reference tutorial (e2e)', () => {
  for (const product of ['wso2-integrator-vscode', 'wso2-integrator']) {
    it(`dry-runs demo-http in ${product}`, async () => {
      const mod = await loadScript(SCRIPT);
      const r = await runTutorial(mod, { product, mode: 'dry' });
      expect(r.failure ? `${r.failure.stepId}: ${r.failure.error}` : null).toBeNull();
      expect(r.events.filter((e) => e.kind === 'step-end').map((e) => e.stepId)).toEqual([
        's1',
        's2',
        's3',
        's4',
        's5',
      ]);
    }, 600_000);
  }
});
