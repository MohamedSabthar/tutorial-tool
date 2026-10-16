import { describe, expect, it } from 'vitest';
import { launchCheck } from '../src/node';

// Opens a real VS Code window (and downloads it on first run), so it only runs on demand:
//   STUDIO_E2E=1 pnpm vitest run packages/recorder
describe.runIf(process.env.STUDIO_E2E)('VS Code launcher (e2e)', () => {
  it('launches WSO2 Integrator full screen with a detected project, twice with the same layout', async () => {
    const a = await launchCheck('wso2-integrator');
    const b = await launchCheck('wso2-integrator');
    expect(a.problems).toEqual([]);
    expect(a.extensionEntry).toBe('WSO2 Integrator');
    expect(a.projectDetected).toBe(true);
    expect(a.titleBar).toContain('WSO2 Integrator');
    expect(a.dialogs).toEqual([]);
    expect(b.activityBar).toEqual(a.activityBar);
  }, 600_000);
});
