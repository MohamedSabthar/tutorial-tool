import type { RecorderEvent } from '@studio/core';
import type { Progress } from '../launch/vscode';
import type { ScreencastFrame } from '../screencast';
import { runTutorial, type RunResult, type ScriptContext, type ScriptFixture } from '../script';
import type { LiveAction, TutMode } from '../tut';

/**
 * A hand-written sample tutorial against WSO2 Integrator, used to exercise the recorder
 * helpers. `broken` swaps in a wrong locator to demonstrate failure reports.
 */
export const sampleFixture: ScriptFixture = {
  kind: 'bi',
  folder: 'greeting-project',
  title: 'Greeting Project',
  integrations: [{ name: 'greeting_service', title: 'Greeting Service' }],
};

export function biOverviewSample(broken = false) {
  return async ({ tut, page, webview }: ScriptContext): Promise<void> => {
    await tut.step('s1', 'Show the Explorer', async () => {
      await tut.click(page.getByRole('tab', { name: /^Explorer/ }), { description: 'Explorer tab' });
    });
    await tut.step('s2', 'Open the WSO2 Integrator view', async () => {
      await tut.click(page.getByRole('tab', { name: 'WSO2 Integrator' }), {
        description: 'WSO2 Integrator tab',
      });
    });
    await tut.step('s3', 'Open the integration', async () => {
      await tut.click(page.locator('.monaco-list-row', { hasText: 'Greeting Service' }).first(), {
        description: 'Greeting Service in the project tree',
      });
    });
    await tut.step('s4', 'Describe what to build', async () => {
      await tut.type(
        webview().getByPlaceholder(/Describe what you want/i),
        'Create a REST API that returns a greeting',
        {
          description: 'Copilot prompt',
        },
      );
      await tut.hold(800);
    });
    await tut.step('s5', 'Choose "Add Artifact manually"', async () => {
      const button = broken
        ? webview().getByRole('button', { name: 'Add Artefact by hand' })
        : webview().getByRole('button', { name: /Add Artifact manually/i });
      await tut.click(button, { description: 'Add Artifact manually button' });
      await tut.hold(800);
    });
  };
}

export type SampleRunResult = RunResult;

export function runSample(opts: {
  mode: TutMode;
  broken?: boolean;
  eventsFile?: string;
  onEvent?: (e: RecorderEvent) => void;
  onAction?: (a: LiveAction) => void;
  onFrame?: (f: ScreencastFrame) => void;
  onProgress?: Progress;
  takeDir?: string;
  takeId?: string;
}): Promise<SampleRunResult> {
  const { broken, ...rest } = opts;
  return runTutorial(
    { fixture: sampleFixture, script: biOverviewSample(broken) },
    { ...rest, captureTargets: true },
  );
}
