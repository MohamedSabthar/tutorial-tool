/**
 * Page objects and actions for HTTP services in WSO2 Integrator. Verified with WSO2
 * Integrator 1.127.0 (extension wso2.wso2-integrator 1.2.0) on 2026-10-16.
 * See ../components/http-service.md for the flow.
 */
import type { ScriptContext } from '@studio/recorder/node';
import { artifacts } from './workbench';

export function httpServiceForm({ webview }: ScriptContext) {
  const wv = webview();
  return {
    basePath: wv.getByRole('textbox', { name: /Service Base Path/i }),
    create: wv.getByRole('button', { name: /^Create$/ }),
  };
}

export function servicePage({ webview }: ScriptContext) {
  const wv = webview();
  return {
    addResource: wv.getByRole('button', { name: /Add Resource/i }),
    /** HTTP method choices after "Add Resource": GET, POST, PUT, DELETE, PATCH, DEFAULT. */
    method: (m: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'DEFAULT') => wv.getByText(m, { exact: true }).first(),
    resourcePath: wv.getByRole('textbox', { name: /Resource Path/i }),
    save: wv.getByRole('button', { name: /^Save$/ }),
  };
}

export function flow({ webview }: ScriptContext) {
  const wv = webview();
  const side = wv.getByTestId('side-panel');
  return {
    /** The "+" on an empty resource flow. */
    addFirstNode: wv.getByTestId('empty-node-add-button-1'),
    /** A node in the node panel, e.g. "Return", "If", "Declare Variable". */
    node: (name: string) => wv.getByText(name, { exact: true }).first(),
    expression: wv.getByTestId('ex-editor-expression').getByRole('textbox').first(),
    closeHelper: wv.getByRole('button', { name: 'Close Helper Panel' }),
    save: side.getByRole('button', { name: /^Save$/ }),
    /** A rendered node in the diagram, e.g. 'Return "Hello, World!"'. */
    diagramText: (text: string) => wv.getByTestId('bi-diagram-canvas').getByText(text).first(),
  };
}

/** Artifacts → HTTP Service → base path → Create. Leaves the service page open. */
export async function createHttpService(ctx: ScriptContext, basePath: string) {
  const { tut } = ctx;
  await tut.click(artifacts(ctx).card('HTTP Service'), { description: 'HTTP Service card' });
  const form = httpServiceForm(ctx);
  await tut.type(form.basePath, basePath, { description: 'Service Base Path', clear: true });
  await tut.click(form.create, { description: 'Create' });
  await tut.waitFor(servicePage(ctx).addResource, 30_000);
}

/** Add Resource → method → path → Save. Leaves the resource flow open. */
export async function addResource(
  ctx: ScriptContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path: string,
) {
  const { tut } = ctx;
  const page = servicePage(ctx);
  await tut.click(page.addResource, { description: 'Add Resource' });
  await tut.click(page.method(method), { description: `${method} method` });
  await tut.type(page.resourcePath, path, { description: 'Resource Path' });
  await tut.click(page.save, { description: 'Save resource' });
  await tut.waitFor(flow(ctx).addFirstNode, 30_000);
}

/** Adds a Return node with the expression as the first node of the flow. */
export async function addReturn(ctx: ScriptContext, expression: string) {
  const { tut } = ctx;
  const f = flow(ctx);
  await tut.click(f.addFirstNode, { description: 'Add node (+)' });
  await tut.click(f.node('Return'), { description: 'Return node' });
  await tut.type(f.expression, expression, { description: 'Return expression', insert: true });
  if (await f.closeHelper.isVisible()) await tut.click(f.closeHelper, { description: 'Close Helper Panel' });
  await tut.click(f.save, { description: 'Save node' });
  await tut.waitFor(f.diagramText('Return'), 20_000);
}
