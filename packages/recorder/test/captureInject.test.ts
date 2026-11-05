// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAPTURE_SOURCE, installCapture, type RawAction } from '../src/capture/inject';

const sent: RawAction[] = [];

beforeAll(() => {
  // jsdom has no layout: give every element a box so it counts as visible.
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      top: 20,
      left: 10,
      right: 40,
      bottom: 60,
      toJSON() {},
    } as DOMRect;
  };
  const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  g.CSS ??= {};
  g.CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);
  (window as unknown as Record<string, unknown>).__tutCapture = (a: RawAction) => {
    sent.push(a);
    return Promise.resolve();
  };
  (window as unknown as Record<string, unknown>).__tutCaptureTest = true;
  installCapture();
});

beforeEach(() => {
  sent.length = 0;
  document.body.innerHTML = '';
});

const mousedown = (el: Element) =>
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, button: 0 }));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, ...init }));

describe('injected capture listener', () => {
  it('names a clicked button by role and name, and counts matches', () => {
    document.body.innerHTML =
      '<div><button><span>Add Agent</span></button><button>Add Agent</button><button>Run</button></div>';
    mousedown(document.querySelector('span')!);
    const a = sent[0]!;
    expect(a.kind).toBe('click');
    if (a.kind !== 'click') return;
    expect(a.label).toBe('button "Add Agent"');
    expect(a.locators[0]).toMatchObject({ by: 'role', value: 'button', name: 'Add Agent', count: 2 });
  });

  it('uses aria-label and placeholder for fields, and sends typing as one action', () => {
    document.body.innerHTML = '<input aria-label="Agent name" placeholder="Name"><button>Create</button>';
    const input = document.querySelector('input')!;
    mousedown(input);
    for (const ch of 'tutor') {
      key(input, ch);
      input.value += ch;
    }
    mousedown(document.querySelector('button')!);
    expect(sent.map((a) => a.kind)).toEqual(['click', 'type', 'click']);
    const t = sent[1]!;
    if (t.kind !== 'type') throw new Error('expected type');
    expect(t.text).toBe('tutor');
    expect(t.clear).toBe(false);
    expect(t.locators.map((l) => l.by)).toEqual(['role', 'label', 'placeholder', 'css']);
  });

  it('marks replaced text as clear and never sends a password', () => {
    document.body.innerHTML = '<input value="old"><input type="password" aria-label="Password">';
    const [field, pw] = Array.from(document.querySelectorAll('input'));
    key(field!, 'x');
    field!.value = 'new';
    key(pw!, 'h');
    pw!.value = 'hunter2';
    key(pw!, 'Enter');
    const [a, b, c] = sent;
    expect(a).toMatchObject({ kind: 'type', text: 'new', clear: true });
    expect(b).toMatchObject({ kind: 'type', text: '«secret»', secret: true });
    expect(JSON.stringify(sent)).not.toContain('hunter2');
    expect(c).toEqual({ kind: 'press', key: 'Enter' });
  });

  it('records chords and ignores plain letters outside fields', () => {
    document.body.innerHTML = '<div tabindex="0">x</div>';
    const d = document.querySelector('div')!;
    key(d, 'a');
    key(d, 'p', { metaKey: true, shiftKey: true });
    expect(sent).toEqual([{ kind: 'press', key: 'Meta+Shift+P' }]);
  });
});

describe('locators in WSO2-style webviews', () => {
  it('names a web component by its host, counts it once, and tells same-named buttons apart by position', () => {
    document.body.innerHTML =
      '<div class="css-1qcscwo"><vscode-button aria-label="Icon Button"></vscode-button><vscode-button aria-label="Icon Button"></vscode-button></div>';
    const hosts = Array.from(document.querySelectorAll('vscode-button'));
    for (const h of hosts) h.attachShadow({ mode: 'open' }).innerHTML = '<button class="control">x</button>';
    mousedown(hosts[1]!.shadowRoot!.querySelector('button')!);
    const a = sent[0]!;
    if (a.kind !== 'click') throw new Error('expected click');
    expect(a.label).toBe('button "Icon Button"');
    const role = a.locators.find((l) => l.by === 'role')!;
    expect(role.count).toBe(2);
    expect(a.locators.find((l) => l.by === 'nth')).toMatchObject({ nth: 1, count: 1 });
    const css = a.locators.find((l) => l.by === 'css')!;
    // The host, not the shadow button, and no generated class names.
    expect(css.value).toBe('vscode-button');
    expect(css.count).toBe(2);
  });

  it('prefers a stable id and skips generated ones', () => {
    document.body.innerHTML =
      '<div class="css-8qbxp2"><input id="functionName" aria-label="Name"></div><input id="list_id_3_12" aria-label="Other">';
    mousedown(document.querySelector('#functionName')!);
    mousedown(document.querySelector('#list_id_3_12')!);
    const [a, b] = sent;
    if (a?.kind !== 'click' || b?.kind !== 'click') throw new Error('expected clicks');
    expect(a.locators.find((l) => l.by === 'id')).toMatchObject({ value: '#functionName', count: 1 });
    expect(b.locators.some((l) => l.by === 'id')).toBe(false);
    expect(b.locators.find((l) => l.by === 'css')!.value).not.toContain('list_id');
  });

  it('ignores placeholder text in code editors and enters their text in one go', () => {
    document.body.innerHTML =
      '<div class="cm-editor"><div class="cm-content" contenteditable="true"><span class="cm-placeholder">e.g., Sales Advisor</span></div></div>';
    const ed = document.querySelector('.cm-content')!;
    // jsdom has no isContentEditable.
    Object.defineProperty(ed, 'isContentEditable', { value: true });
    for (const ch of 'Tutor') key(ed, ch);
    ed.innerHTML = 'Tutor';
    mousedown(document.body);
    expect(sent[0]).toMatchObject({ kind: 'type', text: 'Tutor', clear: false, insert: true });
  });
});

describe('code editor fields', () => {
  it('targets the editor, not the clicked line, and tells two editors apart', () => {
    document.body.innerHTML = ['Agent name', 'Instructions']
      .map(
        (l) =>
          `<div class="row"><span class="field-label">${l}</span><div class="cm-editor"><div class="cm-content" contenteditable="true" role="textbox"><div class="cm-line"></div></div></div></div>`,
      )
      .join('');
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    for (const n of document.querySelectorAll('[contenteditable]'))
      Object.defineProperty(n, 'isContentEditable', { value: true });
    for (const n of lines) Object.defineProperty(n, 'isContentEditable', { value: true });
    mousedown(lines[1]!);
    const a = sent[0]!;
    if (a.kind !== 'click') throw new Error('expected click');
    expect(a.label).toBe('textbox "Instructions"');
    expect(a.locators.find((l) => l.by === 'cssnth')).toMatchObject({ nth: 1, count: 1 });
    expect(a.locators.find((l) => l.by === 'css')!.count).toBe(2);
  });
});

describe('capture source', () => {
  it('runs as a plain string, with no helpers from the bundler', () => {
    const w = window as unknown as Record<string, unknown>;
    w.__tutCaptureInstalled = false;
    expect(() => new Function(CAPTURE_SOURCE)()).not.toThrow();
    expect(w.__tutCaptureInstalled).toBe(true);
  });
});
