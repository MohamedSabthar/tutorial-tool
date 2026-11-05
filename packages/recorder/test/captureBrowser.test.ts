import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachCapture } from '../src/capture/attach';

/**
 * The capture in a real browser: trusted mouse and keyboard input through Playwright, a nested
 * iframe like a VS Code webview (host frame, then the content frame), real layout and the
 * screencast. Skipped when Playwright's Chromium isn't installed.
 */

/** Escapes a document for a srcdoc attribute (& first, so nested escapes survive). */
const attr = (html: string) => html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const WEBVIEW = `<body style="margin:0;font:14px sans-serif">
  <button style="margin:20px">Add Agent</button>
  <input aria-label="Role" style="margin:20px">
</body>`;
const HOST = `<body style="margin:0"><iframe id="active-frame" style="border:0;width:400px;height:200px" srcdoc="${attr(WEBVIEW)}"></iframe></body>`;
const PAGE = `<body style="margin:0;font:14px sans-serif">
  <button id="run" style="position:absolute;left:20px;top:20px">Run</button>
  <div role="tree" tabindex="0" style="position:absolute;left:20px;top:80px">
    <div role="treeitem" aria-label="main.bal">main.bal</div>
    <div role="treeitem" aria-label="config.toml">config.toml</div>
  </div>
  <div class="list" style="position:absolute;left:300px;top:20px;width:200px;height:100px;overflow-y:auto">
    <div style="height:1000px">rows</div>
  </div>
  <button id="a" style="position:absolute;left:20px;top:200px">From</button>
  <button id="b" style="position:absolute;left:220px;top:200px">To</button>
  <iframe class="webview ready" style="position:absolute;left:600px;top:20px;border:0;width:420px;height:220px" srcdoc="${attr(HOST)}"></iframe>
</body>`;

let browser: Browser | null = null;
beforeAll(async () => {
  browser = await chromium.launch().catch(() => null);
});
afterAll(async () => {
  await browser?.close();
});

const center = async (page: Page, sel: string, frames: string[] = []) => {
  // Into nested frames (the webview's host, then its content) when given.
  const [first, ...rest] = frames;
  const l = first
    ? rest.reduce((f, s) => f.frameLocator(s), page.frameLocator(first)).locator(sel)
    : page.locator(sel);
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('capture in a real browser', () => {
  it('captures clicks, webview typing, hovers, scrolls, drags, double-clicks and keys, with marked shots', async (ctx) => {
    if (!browser) return ctx.skip();
    const shotsDir = await mkdtemp(path.join(os.tmpdir(), 'capture-browser-'));
    const page = await browser.newPage({ viewport: { width: 1100, height: 400 } });
    try {
      await page.setContent(PAGE);
      await page.frameLocator('iframe.webview').frameLocator('#active-frame').locator('input').waitFor();
      const cap = await attachCapture(page, { viewport: { width: 1100, height: 400 }, shotsDir });
      await wait(300);
      const wv = ['iframe.webview', '#active-frame'];

      let p = await center(page, '#run');
      await page.mouse.click(p.x, p.y);
      p = await center(page, 'button', wv);
      await page.mouse.click(p.x, p.y);
      p = await center(page, 'input', wv);
      await page.mouse.click(p.x, p.y);
      await page.keyboard.type('Tutor');
      // Clicking back in the workbench ends the typing in the webview.
      p = await center(page, '#run');
      await page.mouse.click(p.x, p.y);
      // Rest on a tree item.
      p = await center(page, '[aria-label="config.toml"]');
      await page.mouse.move(p.x, p.y);
      await wait(1000);
      // Scroll the list.
      p = await center(page, '.list');
      await page.mouse.move(p.x, p.y);
      await page.mouse.wheel(0, 300);
      await wait(600);
      // Drag From onto To.
      p = await center(page, '#a');
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      const q = await center(page, '#b');
      await page.mouse.move(q.x, q.y, { steps: 5 });
      await page.mouse.up();
      // Double-click a file, then type-to-search in the tree and press Enter.
      p = await center(page, '[aria-label="main.bal"]');
      await page.mouse.dblclick(p.x, p.y);
      await page.keyboard.type('ma');
      await page.keyboard.press('Enter');

      const actions = await cap.flush();
      await cap.stop();
      const summary = actions.map(
        (a) => `${a.kind}:${'label' in a ? a.label : 'text' in a ? a.text : a.key}`,
      );
      expect(summary).toEqual([
        'click:button "Run"',
        'click:button "Add Agent"',
        'click:textbox "Role"',
        'type:textbox "Role"',
        'click:button "Run"',
        'hover:treeitem "config.toml"',
        expect.stringMatching(/^scroll:/),
        'drag:button "From"',
        'click:treeitem "main.bal"',
        'keys:ma',
        'press:Enter',
      ]);
      const add = actions[1]!;
      if (add.kind !== 'click') throw new Error('expected a click');
      // A webview target: its own frame, a role locator, and its box in window coordinates.
      expect(add.frame).toBe('webview');
      expect(add.locators[0]).toEqual({
        code: "getByRole('button', { name: 'Add Agent', exact: true })",
        count: 1,
      });
      expect(add.bbox!.x).toBeGreaterThan(600);
      expect(add.point!.x).toBeGreaterThan(600);
      const typed = actions[3]!;
      expect(typed).toMatchObject({ kind: 'type', text: 'Tutor', frame: 'webview' });
      const drag = actions[7]!;
      expect(drag).toMatchObject({ kind: 'drag', to: { label: 'button "To"' } });
      expect(actions[8]).toMatchObject({ kind: 'click', double: true });
      const scroll = actions[6]!;
      expect(scroll).toMatchObject({ kind: 'scroll', dy: 300 });

      // Every targeted action has a marked shot; clicks, typing and keys also have an after shot.
      const files = await readdir(shotsDir);
      for (const a of actions) {
        if ('locators' in a) expect(files).toContain(`${a.id}-marked.jpg`);
        if (a.kind === 'click' || a.kind === 'type') expect(files).toContain(`${a.id}.png`);
      }
      expect(actions.every((a) => !('locators' in a) || a.shot === `${a.id}-marked.jpg`)).toBe(true);
    } finally {
      await page.close();
      await rm(shotsDir, { recursive: true, force: true });
    }
  }, 30_000);
});
