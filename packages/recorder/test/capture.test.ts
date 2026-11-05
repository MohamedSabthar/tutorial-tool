import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaptureAction } from '@studio/core';
import { captureToScript, locatorCode, q, scriptActions, toCaptureLocators } from '../src/capture/codegen';
import { loadScript, type ScriptFixture } from '../src/script';

const fixture: ScriptFixture = { kind: 'empty', folder: 'tutorial', title: 'Tutorial' };

const click = (id: string, code: string, frame: 'main' | 'webview' = 'main', count = 1): CaptureAction => ({
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
    const actions: CaptureAction[] = [
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
    ];
    expect(scriptActions(actions).map((a) => a.id)).toEqual(['a2', 'a3']);
  });

  it('generates a script that loads, with webview targets, keys, ambiguity and secrets marked', async () => {
    const actions: CaptureAction[] = [
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
    ];
    const src = captureToScript(actions, fixture, { title: 'Demo', capturedAt: '2026-11-05' });
    expect(src).toContain(
      "await tut.click(page.getByRole('treeitem', { name: 'main.bal', exact: true }), { description: 'a1' });",
    );
    expect(src).toContain("webview().getByRole('button', { name: 'Add', exact: true }).first()");
    expect(src).toContain('// matched 2 elements when captured');
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
});
