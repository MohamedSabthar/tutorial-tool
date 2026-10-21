/**
 * Reference tutorial: "Create an HTTP service" in WSO2 Integrator. Hand-written. It is the
 * template agent-written scripts follow: a fixture, then short steps built from the
 * product skill's page objects.
 */
import type { ScriptFixture, TutorialScript } from '@studio/recorder/node';
import { addResource, addReturn, createHttpService } from '../../.claude/skills/wso2-integrator/pages/http-service';
import { artifacts, openArtifacts, overview } from '../../.claude/skills/wso2-integrator/pages/workbench';

export const fixture: ScriptFixture = {
  kind: 'bi',
  folder: 'greeting-project',
  title: 'Greeting Project',
  integrations: [{ name: 'greeting_service', title: 'Greeting Service' }],
};

const script: TutorialScript = async (ctx) => {
  const { tut } = ctx;

  await tut.step('s1', 'Open the artifact catalogue', async () => {
    await tut.waitFor(overview(ctx).addArtifactManually, 30_000);
    await tut.hold(1200);
    await openArtifacts(ctx);
    await tut.hold(800);
  });

  await tut.step('s2', 'Create an HTTP service at /greeting', async () => {
    await createHttpService(ctx, '/greeting');
    await tut.hold(1000);
  });

  await tut.step('s3', 'Add a GET resource called hello', async () => {
    await addResource(ctx, 'GET', 'hello');
    await tut.hold(1000);
  });

  await tut.step('s4', 'Return a greeting', async () => {
    await addReturn(ctx, '"Hello, World!"');
    await tut.hold(1200);
  });

  await tut.step('s5', 'Go back to the service overview', async () => {
    await tut.click(artifacts(ctx).breadcrumb('HTTP Service - /greeting'), { description: 'HTTP Service breadcrumb' });
    await tut.hold(1500);
  });
};

export default script;
