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

describe('capture source', () => {
  it('runs as a plain string, with no helpers from the bundler', () => {
    const w = window as unknown as Record<string, unknown>;
    w.__tutCaptureInstalled = false;
    expect(() => new Function(CAPTURE_SOURCE)()).not.toThrow();
    expect(w.__tutCaptureInstalled).toBe(true);
  });
});
