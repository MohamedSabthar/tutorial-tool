import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureAction } from '@studio/core';
import { captureToScript, locatorCode, q, scriptActions, toCaptureLocators } from '../src/capture/codegen';
import { markFilters } from '../src/capture/marks';
import { loadScript, type ScriptFixture } from '../src/script';

const fixture: ScriptFixture = { kind: 'empty', folder: 'tutorial', title: 'Tutorial' };

const click = (id: string, code: string, frame: 'main' | 'webview' = 'main', count = 1) => ({
  kind: 'click',
  id,
  t: 1,
  frame,
  label: `button "${id}"`,
  locators: [{ code, count }],
  bbox: null,
  button: 'left',
});

describe('capture codegen', () => {
  it('quotes strings safely', () => {
    expect(q("it's a \\ path\nx")).toBe("'it\\'s a \\\\ path\\nx'");
  });

  it('writes Playwright locator code', () => {
    expect(locatorCode({ by: 'role', value: 'button', name: 'Add Agent', count: 1 })).toBe(
      "getByRole('button', { name: 'Add Agent', exact: true })",
    );
    expect(locatorCode({ by: 'placeholder', value: 'Name', count: 1 })).toBe(
      "getByPlaceholder('Name', { exact: true })",
    );
    expect(locatorCode({ by: 'css', value: '#run', count: 1 })).toBe("locator('#run')");
  });

  it('puts unique locators first', () => {
    const out = toCaptureLocators([
      { by: 'role', value: 'button', name: 'Add', count: 3 },
      { by: 'text', value: 'Add', count: 2 },
      { by: 'css', value: '#add', count: 1 },
    ]);
    expect(out.map((l) => l.count)).toEqual([1, 2, 3]);
    expect(out[0]!.code).toBe("locator('#add')");
  });

  it('drops the click that focuses a field before typing into it', () => {
    const field = "getByLabel('Name', { exact: true })";
    const actions: CaptureAction[] = CaptureAction.array().parse([
      click('a1', field),
      {
        ...(click('a2', field) as object),
        kind: 'type',
        text: 'hi',
        clear: false,
        insert: false,
        secret: false,
      } as CaptureAction,
      click('a3', "getByRole('button', { name: 'OK', exact: true })"),
    ]);
    expect(scriptActions(actions).map((a) => a.id)).toEqual(['a2', 'a3']);
  });

  it('generates a script that loads, with webview targets, keys, ambiguity and secrets marked', async () => {
    const actions: CaptureAction[] = CaptureAction.array().parse([
      click('a1', "getByRole('treeitem', { name: 'main.bal', exact: true })"),
      click('a2', "getByRole('button', { name: 'Add', exact: true })", 'webview', 2),
      {
        kind: 'type',
        id: 'a3',
        t: 2,
        frame: 'webview',
        label: 'textbox "Password"',
        locators: [{ code: "getByLabel('Password', { exact: true })", count: 1 }],
        bbox: null,
        text: '«secret»',
        clear: true,
        insert: false,
        secret: true,
      },
      { kind: 'press', id: 'a4', t: 3, key: 'Meta+Shift+P' },
    ]);
    const src = captureToScript(actions, fixture, { title: 'Demo', capturedAt: '2026-11-05' });
    expect(src).toContain(
      "await tut.click(page.getByRole('treeitem', { name: 'main.bal', exact: true }), { description: 'a1' });",
    );
    expect(src).toContain("webview().getByRole('button', { name: 'Add', exact: true }).first()");
    expect(src).toContain('// review: matched 2 elements when captured: check the marked shot');
    expect(src).toContain('// TODO: a password field');
    expect(src).toContain("{ description: 'Password', clear: true }");
    expect(src).toContain("await tut.press('Meta+Shift+P');");
    expect(src).toContain('async ({ tut, page, webview })');

    const dir = await mkdtemp(path.join(os.tmpdir(), 'capture-test-'));
    try {
      const file = path.join(dir, 'script.spec.ts');
      await writeFile(file, src);
      const mod = await loadScript(file);
      expect(mod.fixture).toEqual(fixture);
      expect(typeof mod.script).toBe('function');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes hovers, scrolls, drags, double and right clicks, and keys, flagging what needs review', () => {
    const t = (code: string) => ({
      frame: 'webview',
      label: 'x',
      locators: [{ code, count: 1 }],
      bbox: null,
    });
    const actions = CaptureAction.array().parse([
      {
        kind: 'hover',
        id: 'a1',
        t: 1,
        ...t("getByRole('treeitem', { name: 'main', exact: true })"),
        shot: 'a1-marked.jpg',
      },
      {
        kind: 'click',
        id: 'a2',
        t: 2,
        ...t("getByRole('button', { name: 'Delete', exact: true })"),
        button: 'left',
      },
      { kind: 'scroll', id: 'a3', t: 3, ...t("locator('.list')"), dx: 0, dy: 480 },
      {
        kind: 'drag',
        id: 'a4',
        t: 4,
        ...t("getByText('A', { exact: true })"),
        to: t("getByText('B', { exact: true })"),
        toPoint: null,
      },
      {
        kind: 'click',
        id: 'a5',
        t: 5,
        ...t("getByText('main', { exact: true })"),
        button: 'right',
        double: false,
      },
      {
        kind: 'click',
        id: 'a6',
        t: 6,
        ...t("getByText('file', { exact: true })"),
        button: 'left',
        double: true,
      },
      { kind: 'keys', id: 'a7', t: 7, text: 'mai' },
    ]);
    const src = captureToScript(actions, fixture, { title: 'T', capturedAt: 'd' });
    expect(src).toContain("await tut.hover(webview().getByRole('treeitem', { name: 'main', exact: true })");
    expect(src).toContain('// a1 · Hover over x · shots/a1-marked.jpg');
    expect(src).toContain('// review: keep only if it reveals what comes next');
    expect(src).toContain("await tut.scroll(webview().locator('.list'), 480, { description: 'x' });");
    expect(src).toContain(
      "await tut.drag(webview().getByText('A', { exact: true }), webview().getByText('B', { exact: true })",
    );
    expect(src).toContain("button: 'right'");
    expect(src).toContain('double: true');
    expect(src).toContain("await page.keyboard.type('mai');");
  });

  it('drops a hover just before clicking the same target', () => {
    const t = {
      frame: 'main',
      label: 'x',
      locators: [{ code: "getByText('Run', { exact: true })", count: 1 }],
      bbox: null,
    };
    const actions = CaptureAction.array().parse([
      { kind: 'hover', id: 'a1', t: 1, ...t },
      { kind: 'click', id: 'a2', t: 2, ...t, button: 'left' },
    ]);
    expect(scriptActions(actions).map((a) => a.id)).toEqual(['a2']);
  });

  it('marks the target box and the pointer in fractions of the frame', () => {
    const f = markFilters({
      box: { x: 100, y: 50, w: 200, h: 20 },
      point: { x: 150, y: 60 },
      viewport: { width: 1000, height: 500 },
    });
    expect(f[0]).toContain('x=iw*0.09700:y=ih*0.09400');
    expect(f).toHaveLength(4);
    expect(markFilters({ box: null, point: null, viewport: { width: 1, height: 1 } })).toEqual([]);
  });
});
