/**
 * Page objects for the WSO2 Integrator workbench: activity bar, project tree, the
 * integration overview and the artifact catalogue. Verified with WSO2 Integrator 1.127.0.
 */
import type { ScriptContext } from '@studio/recorder/node';

export function workbench({ page }: ScriptContext) {
  return {
    integratorTab: page.getByRole('tab', { name: 'WSO2 Integrator' }),
    explorerTab: page.getByRole('tab', { name: /^Explorer/ }),
    /** A row in the WSO2 Integrator project tree, e.g. "Greeting Service". */
    treeRow: (text: string) => page.locator('.monaco-list-row', { hasText: text }).first(),
  };
}

export function overview({ webview }: ScriptContext) {
  const wv = webview();
  return {
    copilotPrompt: wv.getByPlaceholder(/Describe what you want/i),
    addArtifactManually: wv.getByRole('button', { name: /Add Artifact manually/i }),
  };
}

export function artifacts({ webview }: ScriptContext) {
  const wv = webview();
  return {
    search: wv.getByPlaceholder(/Search artifacts/i),
    /** A card in the catalogue, e.g. "HTTP Service", "Automation", "Kafka". */
    card: (name: string) => wv.getByRole('button', { name: new RegExp(`${name}$`) }).first(),
    /** Breadcrumb links at the top of the editor, e.g. "HTTP Service - /greeting". */
    breadcrumb: (text: string) => wv.getByText(text, { exact: true }).first(),
  };
}

/** Opens the artifact catalogue from the integration overview. */
export async function openArtifacts(ctx: ScriptContext) {
  await ctx.tut.click(overview(ctx).addArtifactManually, { description: 'Add Artifact manually' });
}
