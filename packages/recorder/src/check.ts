import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBIProject } from './fixtures/biProject';
import { launchVSCode, type Progress, type Viewport } from './launch/vscode';
import { getProduct, readAppBundle } from './products';

export interface LaunchCheckResult {
  ok: boolean;
  product: string;
  vscodeVersion: string;
  viewport: Viewport;
  activityBar: string[];
  extensionEntry: string | null;
  /** Text of the in-window title bar (must name the product). */
  titleBar: string;
  /** The product recognised the fixture as a project and shows its integration. */
  projectDetected: boolean;
  /** Dialogs that appeared (in-window or native). Any dialog at startup is a problem. */
  dialogs: string[];
  screenshot: { width: number; height: number; png: Buffer };
  durationMs: number;
  problems: string[];
}

const FIXTURE = {
  folder: 'greeting-project',
  title: 'Greeting Project',
  integration: { name: 'greeting_service', title: 'Greeting Service' },
};

/**
 * Launches the product in its recording window with a valid BI project (an empty folder makes WSO2
 * Integrator show a blocking "couldn't detect the project type" modal), then checks: the
 * activity-bar entry exists, the title bar shows the product name, the project is detected,
 * no dialog appeared, and the frame matches the window size × scale.
 */
export async function launchCheck(
  productId: string,
  onProgress: Progress = () => {},
): Promise<LaunchCheckResult> {
  const started = Date.now();
  const product = getProduct(productId);
  const base = await mkdtemp(path.join(os.tmpdir(), 'studio-fixture-'));
  const fixture = path.join(base, FIXTURE.folder);
  onProgress('Creating a WSO2 Integrator project fixture…');
  await createBIProject(fixture, { title: FIXTURE.title, integrations: [FIXTURE.integration] });

  const session =
    product.type === 'vscode-app'
      ? await launchVSCode({
          fixture,
          extensions: [],
          executable: readAppBundle(product.appPath).executable,
          onProgress,
        })
      : await launchVSCode({ fixture, extensions: product.extensions, onProgress });
  const problems: string[] = [];
  try {
    const { page } = session;

    // Extensions activate a moment after the workbench appears.
    const items = page.locator('.activitybar .action-item a, .activitybar .action-item .action-label');
    let labels: string[] = [];
    let entry: string | null = null;
    for (let i = 0; i < 40 && !entry; i++) {
      labels = (
        await items.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '').filter(Boolean))
      ).map((l) => l.trim());
      entry = labels.find((l) => product.activityBarLabel.test(l)) ?? null;
      if (!entry) await page.waitForTimeout(500);
    }
    if (!entry)
      problems.push(
        `no activity-bar entry matching ${product.activityBarLabel} (found: ${labels.join(', ')})`,
      );

    onProgress('Waiting for the project to load…');
    const projectDetected = await page
      .locator('.monaco-list-row', { hasText: FIXTURE.integration.title })
      .first()
      .waitFor({ state: 'visible', timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    if (!projectDetected) problems.push(`the project tree never showed "${FIXTURE.integration.title}"`);

    const titleBarLocator = page.locator('.part.titlebar');
    const titleBar = (await titleBarLocator.isVisible())
      ? (await titleBarLocator.innerText()).replace(/\s+/g, ' ').trim()
      : '';
    if (!titleBar) problems.push('the title bar is hidden');
    else if (!titleBar.includes(product.name.replace(/ \(.*\)$/, '')))
      problems.push(`the title bar does not name the product ("${titleBar}")`);

    const dialogs = [
      ...(await page.locator('.monaco-dialog-box').allInnerTexts()).map(
        (t) => `in-window: ${t.replace(/\s+/g, ' ').trim()}`,
      ),
      ...(await session.nativeDialogs()).map((d) => `native: ${d.message ?? ''} ${d.detail ?? ''}`.trim()),
    ];
    for (const d of dialogs) problems.push(`dialog appeared: ${d}`);

    const png = await page.screenshot();
    const size = pngSize(png);
    const expected = {
      width: Math.round(session.viewport.width * session.viewport.scale),
      height: Math.round(session.viewport.height * session.viewport.scale),
    };
    if (Math.abs(size.width - expected.width) > 1 || Math.abs(size.height - expected.height) > 1)
      problems.push(`frame is ${size.width}×${size.height}, expected ${expected.width}×${expected.height}`);

    onProgress(problems.length ? `Check finished with ${problems.length} problem(s)` : 'Check passed');
    return {
      ok: problems.length === 0,
      product: product.id,
      vscodeVersion: session.version,
      viewport: session.viewport,
      activityBar: labels,
      extensionEntry: entry,
      titleBar,
      projectDetected,
      dialogs,
      screenshot: { ...size, png },
      durationMs: Date.now() - started,
      problems,
    };
  } finally {
    await session.close();
    await rm(base, { recursive: true, force: true });
  }
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
