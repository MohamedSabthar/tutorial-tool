/**
 * The listener injected into every frame of the product window while capturing. It must be
 * self-contained: Playwright serialises the function and runs it in the page, so it can't use
 * imports or anything from module scope.
 *
 * It reports raw actions through the `__tutCapture` binding. For each target it works out a few
 * candidate locators (role + name, label, placeholder, text, test id, CSS) and counts their
 * matches right away, while the element is still on screen: by the time Node could probe, the
 * click has usually changed the UI.
 */

export interface RawLocator {
  /** 'role' | 'nth' | 'scoped' | 'id' | 'label' | 'placeholder' | 'testid' | 'text' | 'css' | 'cssnth' */
  by: string;
  /** For 'role' and 'nth', the role; otherwise the value. */
  value: string;
  /** For 'role' and 'nth', the accessible name; for 'scoped', the clicked text inside the test id `value`. */
  name?: string;
  /** For 'nth' and 'cssnth', the index among the matches. */
  nth?: number;
  count: number;
}

export interface RawTarget {
  label: string;
  locators: RawLocator[];
  bbox: { x: number; y: number; w: number; h: number } | null;
}

export type RawAction =
  | ({ kind: 'click'; button: 'left' | 'right' } & RawTarget)
  | ({ kind: 'type'; text: string; clear: boolean; insert: boolean; secret: boolean } & RawTarget)
  | { kind: 'press'; key: string };

export const BINDING = '__tutCapture';
export const FLUSH = '__tutCaptureFlush';

export function installCapture(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__tutCaptureInstalled) return;
  w.__tutCaptureInstalled = true;
  const send = (a: unknown) => {
    const fn = w.__tutCapture as ((a: unknown) => Promise<void>) | undefined;
    if (typeof fn === 'function') void fn(a).catch(() => {});
  };
  // Only the user's own input counts, not events the product or a script dispatches. Tests
  // (jsdom can't make trusted events) set __tutCaptureTest.
  const trusted = (e: Event) => e.isTrusted || w.__tutCaptureTest === true;

  const IMPLICIT: Record<string, string> = {
    BUTTON: 'button',
    SELECT: 'combobox',
    TEXTAREA: 'textbox',
    H1: 'heading',
    H2: 'heading',
    H3: 'heading',
    H4: 'heading',
    H5: 'heading',
    H6: 'heading',
    SUMMARY: 'button',
    'VSCODE-BUTTON': 'button',
    'VSCODE-CHECKBOX': 'checkbox',
    'VSCODE-TEXT-FIELD': 'textbox',
    'VSCODE-TEXT-AREA': 'textbox',
    'VSCODE-DROPDOWN': 'combobox',
    'VSCODE-OPTION': 'option',
    'VSCODE-LINK': 'link',
  };
  const INTERACTIVE = new Set([
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'textbox',
    'searchbox',
    'combobox',
    'option',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'treeitem',
    'listitem',
    'gridcell',
    'row',
    'spinbutton',
    'slider',
  ]);

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(' ')[0]!;
    if (el.tagName === 'A' && el.hasAttribute('href')) return 'link';
    if (el.tagName === 'INPUT') {
      const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      if (t === 'search') return 'searchbox';
      if (t === 'number') return 'spinbutton';
      if (t === 'range') return 'slider';
      if (t === 'hidden' || t === 'file') return '';
      return 'textbox';
    }
    if (el.tagName === 'LI' && el.parentElement && /^(UL|OL)$/.test(el.parentElement.tagName))
      return 'listitem';
    return IMPLICIT[el.tagName] ?? '';
  };

  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

  const labelText = (el: Element): string => {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) return norm(labels[0]!.textContent);
    return '';
  };

  const nameOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return norm(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const root = el.getRootNode() as Document | ShadowRoot;
      const t = by
        .split(/\s+/)
        .map((id) => norm(root.getElementById?.(id)?.textContent))
        .filter(Boolean)
        .join(' ');
      if (t) return t;
    }
    const role = roleOf(el);
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton') {
      return labelText(el) || norm(el.getAttribute('title')) || norm(el.getAttribute('placeholder'));
    }
    if (el.tagName === 'INPUT') return norm((el as HTMLInputElement).value) || norm(el.getAttribute('title'));
    const text = norm(el.textContent);
    if (text && text.length <= 80) return text;
    return norm(el.getAttribute('title')) || norm(el.querySelector('img')?.getAttribute('alt'));
  };

  /** Every element in the document, including open shadow roots (Playwright's locators pierce them). */
  const all = (): Element[] => {
    const out: Element[] = [];
    const walk = (root: Document | ShadowRoot) => {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out;
  };

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };

  /** The element the user meant: the nearest interactive one on the event path. */
  /**
   * The element the user meant, and the test-id container it sits in when that's all that marks
   * it as clickable. A row like "No trigger yet · Add Trigger" carries the test id, but only its
   * "Add Trigger" link acts: a click anywhere else in the row's box does nothing.
   */
  const pick = (path: EventTarget[]): { el: Element; scope: Element | null } | null => {
    const els = path.filter((n): n is Element => n instanceof Element);
    for (const [i, el] of els.entries()) {
      if (el.tagName === 'BODY' || el.tagName === 'HTML') break;
      const role = roleOf(el);
      if (INTERACTIVE.has(role)) return { el, scope: null };
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
        return { el, scope: null };
      if (el.hasAttribute('data-testid') || (el as HTMLElement).onclick) {
        const own = norm(el.textContent);
        // The innermost element under the pointer with a short text that is only part of the container's.
        const inner = els.slice(0, i).find((x) => {
          const t = norm(x.textContent);
          return t && t.length <= 40 && t !== own;
        });
        return inner ? { el: inner, scope: el } : { el, scope: null };
      }
    }
    // Nothing interactive: the innermost element with a short text of its own.
    for (const el of els) {
      if (el.tagName === 'BODY') break;
      const t = norm(el.textContent);
      if (t && t.length <= 60) return { el, scope: null };
    }
    return els[0] ? { el: els[0], scope: null } : null;
  };

  /** Generated names that change from build to build (CSS-in-JS hashes, CodeMirror's ͼ classes, counters). */
  const generated = (c: string) =>
    /^(css|sc|jsx|emotion|svelte)-|^ͼ|\d{2,}|focused|selected|hover|active/.test(c);
  /** An id a person wrote (functionName), not one generated per render (list_id_3_12, :r5:). */
  const stableId = (id: string) => !!id && !/\d{2,}|[:_-]\d|^[a-f0-9-]{8,}$/.test(id);

  /** The outermost element in the light DOM: CSS selectors (and the count of their matches) can't see into shadow roots. */
  const lightOf = (el: Element): Element => {
    let cur = el;
    for (let root = cur.getRootNode(); root instanceof ShadowRoot; root = cur.getRootNode()) cur = root.host;
    return cur;
  };

  /** A short CSS path from stable ids and classes, ending at the element (or its shadow host). */
  const cssPath = (target: Element): string => {
    const el = lightOf(target);
    if (stableId(el.id)) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && parts.length < 4 && cur.tagName !== 'BODY') {
      if (cur !== el && stableId(cur.id)) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const classes = Array.from(cur.classList)
        .filter((c) => !generated(c))
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join('');
      // Plain tags with no stable class say little: keep only the element's own and those with a class.
      if (cur === el || classes) parts.unshift(`${cur.tagName.toLowerCase()}${classes}`);
      cur = cur.parentElement;
    }
    // An icon-only button is told apart by its icon.
    const icon = [target, el]
      .flatMap((root) => Array.from(root.querySelectorAll('[class*="codicon-"]')))
      .flatMap((i) => Array.from(i.classList))
      .find((c) => /^codicon-[a-z-]+$/.test(c));
    if (icon) parts[parts.length - 1] += `:has(.${icon})`;
    return parts.join(' ');
  };

  /**
   * The text a person sees next to an unnamed field: the nearest label-like element before it
   * in its form row (WSO2 forms label code editors this way, without an aria link).
   */
  const nearbyLabel = (el: Element): string => {
    let cur: Element | null = lightOf(el);
    for (let up = 0; cur && up < 4; up++, cur = cur.parentElement) {
      const parent: Element | null = cur.parentElement;
      if (!parent) break;
      const before = Array.from(
        parent.querySelectorAll('label, [class*="label" i], [class*="title" i]'),
      ).filter(
        (l) => l.compareDocumentPosition(lightOf(el)) & Node.DOCUMENT_POSITION_FOLLOWING && !l.contains(el),
      );
      const t = norm(before.at(-1)?.textContent);
      if (t && t.length <= 60) return t;
    }
    return '';
  };

  /** A short human label for an action's target. */
  const labelFor = (el: Element, role: string, name: string, css: string): string => {
    const n = name || (role === 'textbox' || role === 'combobox' ? nearbyLabel(el) : '');
    if (role) return `${role}${n ? ` "${n.slice(0, 60)}"` : ''}`;
    if (n) return `"${n.slice(0, 60)}"`;
    const testid = el.getAttribute('data-testid');
    if (testid) return `[${testid}]`;
    return css;
  };

  const describeTarget = (el: Element, scope: Element | null = null) => {
    const els = all();
    const role = roleOf(el);
    const name = nameOf(el);
    const locators: RawLocator[] = [];
    const add = (by: string, value: string, count: number, nm?: string) => {
      if (!value || count < 1 || locators.some((l) => l.by === by)) return;
      locators.push({ by, value, count, ...(nm !== undefined ? { name: nm } : {}) });
    };
    // The text that was clicked, inside its test-id container.
    const scopeId = scope?.getAttribute('data-testid');
    const innerText = norm(el.textContent);
    if (scope && scopeId && innerText) {
      const within = Array.from(scope.querySelectorAll('*')).filter(
        (e) =>
          norm(e.textContent) === innerText &&
          !Array.from(e.children).some((c) => norm(c.textContent) === innerText),
      ).length;
      const scopes = els.filter((e) => e.getAttribute('data-testid') === scopeId).length;
      add('scoped', scopeId, scopes === 1 ? within : Math.max(within, scopes), innerText);
    }
    if (role && name) {
      const same = els.filter((e) => roleOf(e) === role && nameOf(e) === name && visible(e));
      // A web component and the input in its shadow root are one control, not two.
      const hostIn = (e: Element) => {
        const r = e.getRootNode();
        return r instanceof ShadowRoot && same.includes(r.host);
      };
      const matches = same.filter((e) => !hostIn(e));
      add('role', role, matches.length, name);
      // Not unique: its position among them, right for this screen.
      const at = matches.indexOf(el);
      if (matches.length > 1 && at >= 0) locators.push({ by: 'nth', value: role, name, nth: at, count: 1 });
    }
    if (stableId(el.id) && el.getRootNode() === document)
      add('id', `#${CSS.escape(el.id)}`, document.querySelectorAll(`#${CSS.escape(el.id)}`).length);
    const label = labelText(el) || norm(el.getAttribute('aria-label'));
    if (label && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'))
      add(
        'label',
        label,
        els.filter((e) => labelText(e) === label || norm(e.getAttribute('aria-label')) === label).length,
      );
    const ph = norm(el.getAttribute('placeholder'));
    if (ph) add('placeholder', ph, els.filter((e) => norm(e.getAttribute('placeholder')) === ph).length);
    const testid = el.getAttribute('data-testid');
    if (testid) add('testid', testid, els.filter((e) => e.getAttribute('data-testid') === testid).length);
    const text = norm(el.textContent);
    if (text && text.length <= 60 && !el.matches('input,textarea') && !(el as HTMLElement).isContentEditable)
      add(
        'text',
        text,
        // Playwright's getByText matches the smallest elements with the text.
        els.filter(
          (e) =>
            norm(e.textContent) === text &&
            !Array.from(e.children).some((c) => norm(c.textContent) === text) &&
            visible(e),
        ).length,
      );
    const css = cssPath(el);
    if (css) {
      // Unknown (a selector the engine rejects) counts as many, never as unique.
      let count: number;
      try {
        count = document.querySelectorAll(css).length || 99;
      } catch {
        count = 99;
      }
      if (!locators.some((l) => l.by === 'id' && `${l.value}` === css)) add('css', css, count);
      // Not unique: its position among the matches, right for this screen.
      if (count > 1 && count < 99) {
        const at = Array.from(document.querySelectorAll(css)).indexOf(lightOf(el));
        if (at >= 0) locators.push({ by: 'cssnth', value: css, nth: at, count: 1 });
      }
    }
    const r = el.getBoundingClientRect();
    // Frames inside webviews report boxes relative to themselves; Node offsets them.
    return {
      label: labelFor(el, role, name, css),
      locators,
      bbox: r.width || r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    };
  };

  // ---- typing ---------------------------------------------------------------------------
  // Keystrokes into one field are kept and sent as one action when the user moves on.
  let typing: {
    el: Element;
    target: ReturnType<typeof describeTarget>;
    initial: string;
    keys: string;
    secret: boolean;
    insert: boolean;
  } | null = null;

  const valueOf = (el: Element): string | null => {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      // Monaco's hidden textarea only holds a window of the text: use the keystrokes instead.
      if (el.classList.contains('inputarea')) return null;
      return (el as HTMLInputElement).value;
    }
    if ((el as HTMLElement).isContentEditable) {
      // Leave out placeholder text drawn inside the editor (CodeMirror's .cm-placeholder).
      const copy = el.cloneNode(true) as Element;
      copy.querySelectorAll('[class*="placeholder"],[aria-hidden="true"]').forEach((n) => n.remove());
      return norm(copy.textContent);
    }
    return null;
  };

  const flush = () => {
    const t = typing;
    typing = null;
    if (!t) return;
    const now = valueOf(t.el);
    let text = t.keys;
    let clear = false;
    if (now !== null) {
      if (now === t.initial) return;
      if (t.initial && now.startsWith(t.initial)) text = now.slice(t.initial.length);
      else {
        text = now;
        clear = t.initial.length > 0;
      }
    }
    if (!text && !clear) return;
    send({
      kind: 'type',
      ...t.target,
      text: t.secret ? '«secret»' : text,
      clear,
      insert: t.insert,
      secret: t.secret,
    });
  };
  w.__tutCaptureFlush = flush;

  const fieldOf = (path: EventTarget[]): Element | null => {
    for (const n of path) {
      if (!(n instanceof Element)) continue;
      if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') return n;
      // The editable root, not the line inside it that was clicked (CodeMirror's .cm-line).
      if ((n as HTMLElement).isContentEditable)
        return n.closest('[contenteditable]:not([contenteditable="false"])') ?? n;
    }
    return null;
  };

  /** The element to name for a field: a web component host (vscode-text-field) rather than its inner input. */
  const hostOf = (el: Element): Element => {
    const root = el.getRootNode();
    if (root instanceof ShadowRoot && /^VSCODE-/.test(root.host.tagName)) return root.host;
    return el;
  };

  const startTyping = (field: Element) => {
    if (typing?.el === field) return;
    flush();
    const monaco = field.classList.contains('inputarea') || !!field.closest('.monaco-editor');
    // Code editors (Monaco, CodeMirror) auto-close brackets: their text is entered in one go.
    const code = monaco || !!field.closest('.cm-editor');
    const target = describeTarget(monaco ? (field.closest('.monaco-editor') ?? field) : hostOf(field));
    typing = {
      el: field,
      target,
      initial: valueOf(field) ?? '',
      keys: '',
      secret: (field as HTMLInputElement).type === 'password',
      insert: code,
    };
  };

  const SPECIAL = new Set([
    'Enter',
    'Escape',
    'Tab',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Delete',
    'F1',
    'F2',
    'F5',
  ]);

  document.addEventListener(
    'keydown',
    (e) => {
      if (!trusted(e) || e.repeat) return;
      const path = e.composedPath();
      const field = fieldOf(path);
      const chord = e.metaKey || e.ctrlKey || e.altKey;
      if (!chord && field && (e.key.length === 1 || e.key === 'Backspace')) {
        startTyping(field);
        if (typing) typing.keys = e.key === 'Backspace' ? typing.keys.slice(0, -1) : typing.keys + e.key;
        return;
      }
      // Paste and select-all inside a field are part of typing: the value is read when it ends.
      if (field && (e.metaKey || e.ctrlKey) && /^[vaxz]$/i.test(e.key)) {
        startTyping(field);
        return;
      }
      if (/^(Meta|Control|Alt|Shift|CapsLock)$/.test(e.key)) return;
      if (!chord && !SPECIAL.has(e.key) && !/^F\d+$/.test(e.key)) return;
      flush();
      const mods = [
        e.metaKey && 'Meta',
        e.ctrlKey && 'Control',
        e.altKey && 'Alt',
        e.shiftKey && chord && 'Shift',
      ]
        .filter(Boolean)
        .join('+');
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      send({ kind: 'press', key: mods ? `${mods}+${key}` : key });
    },
    true,
  );

  document.addEventListener(
    'input',
    (e) => {
      if (!trusted(e)) return;
      const field = fieldOf(e.composedPath());
      if (field && typing?.el !== field) startTyping(field);
    },
    true,
  );

  // Pressed, not clicked: menus and quick picks often act (and vanish) on mousedown, so the
  // target is named while it's still there.
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!trusted(e) || (e.button !== 0 && e.button !== 2)) return;
      const path = e.composedPath();
      const picked = pick(path);
      if (!picked) return;
      const { el, scope } = picked;
      // Dragging the window by its title bar isn't part of the tutorial.
      if (el.closest('.part.titlebar') && !INTERACTIVE.has(roleOf(el))) return;
      const field = fieldOf(path);
      if (typing && typing.el !== field) flush();
      send({
        kind: 'click',
        button: e.button === 2 ? 'right' : 'left',
        ...describeTarget(hostOf(field ?? el), field ? null : scope),
      });
    },
    true,
  );

  window.addEventListener('blur', flush, true);
  document.addEventListener(
    'focusout',
    (e) => {
      if (typing && e.target === typing.el) flush();
    },
    true,
  );
}

/**
 * The listener as source to run in a frame. Bundlers that keep function names (tsx, esbuild's
 * keepNames) wrap inner functions in a `__name()` helper that doesn't exist in the page, so a
 * stand-in is defined around it.
 */
export const CAPTURE_SOURCE = `(() => { const __name = (f) => f; (${installCapture.toString()})(); })();`;
