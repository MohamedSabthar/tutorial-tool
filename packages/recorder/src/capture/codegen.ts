import {
  describeAction,
  needsReview,
  type CaptureAction,
  type CaptureLocator,
  type CaptureTarget,
} from '@studio/core';
import type { ScriptFixture } from '../script';
import type { RawLocator } from './inject';

/** A single-quoted JS string literal. */
export function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** Playwright locator code for a raw locator, relative to its frame (`page.` or `webview().` goes in front). */
export function locatorCode(l: RawLocator): string {
  switch (l.by) {
    case 'role':
      return `getByRole(${q(l.value)}, { name: ${q(l.name ?? '')}, exact: true })`;
    case 'nth':
      return `getByRole(${q(l.value)}, { name: ${q(l.name ?? '')}, exact: true }).nth(${l.nth ?? 0})`;
    case 'id':
      return `locator(${q(l.value)})`;
    case 'scoped':
      return `getByTestId(${q(l.value)}).getByText(${q(l.name ?? '')}, { exact: true })`;
    case 'cssnth':
      return `locator(${q(l.value)}).nth(${l.nth ?? 0})`;
    case 'label':
      return `getByLabel(${q(l.value)}, { exact: true })`;
    case 'placeholder':
      return `getByPlaceholder(${q(l.value)}, { exact: true })`;
    case 'text':
      return `getByText(${q(l.value)}, { exact: true })`;
    case 'testid':
      return `getByTestId(${q(l.value)})`;
    default:
      return `locator(${q(l.value)})`;
  }
}

/**
 * How much a unique locator is preferred: what the user reads (role and name) first, then
 * stable ids and labels, then text; a position (nth) or a CSS path only when nothing else is.
 */
const RANK = ['role', 'scoped', 'id', 'label', 'placeholder', 'testid', 'text', 'nth', 'css', 'cssnth'];
const rank = (l: RawLocator) => (RANK.includes(l.by) ? RANK.indexOf(l.by) : RANK.length);

/** Candidate locators as code, those matching exactly one element first (in preference order). */
export function toCaptureLocators(raw: RawLocator[]): CaptureLocator[] {
  const unique = raw.filter((l) => l.count === 1).sort((a, b) => rank(a) - rank(b));
  const rest = raw.filter((l) => l.count !== 1).sort((a, b) => a.count - b.count);
  return [...unique, ...rest].map((l) => ({ code: locatorCode(l), count: l.count }));
}

type Targeted = Extract<CaptureAction, { locators: unknown }>;

function targetCode(a: CaptureTarget): string {
  const best = a.locators[0];
  const root = a.frame === 'webview' ? 'webview()' : 'page';
  if (!best) return `${root}.locator('body') /* TODO: no locator captured for ${a.label} */`;
  return `${root}.${best.code}${best.count > 1 ? '.first()' : ''}`;
}

/** The name the user would read on the target, for the event label (`description`). */
function descriptionOf(a: CaptureTarget): string {
  const m = /"(.*)"/.exec(a.label);
  return (m?.[1] ?? a.label).slice(0, 60);
}

function sameTarget(a: Targeted, b: Targeted): boolean {
  return a.frame === b.frame && a.locators[0]?.code === b.locators[0]?.code;
}

/**
 * The actions a draft script needs. Only what replaying makes redundant is dropped: a left click
 * straight before typing into the same field (tut.type clicks it), and resting on a target just
 * before clicking it (tut.click moves there). Everything else stays for the agent to judge.
 */
export function scriptActions(actions: CaptureAction[]): CaptureAction[] {
  return actions.filter((a, i) => {
    const next = actions[i + 1];
    if (
      a.kind === 'click' &&
      a.button === 'left' &&
      !a.double &&
      next?.kind === 'type' &&
      sameTarget(a, next)
    )
      return false;
    if (a.kind === 'hover' && next && 'locators' in next && next.kind !== 'scroll' && sameTarget(a, next))
      return false;
    return true;
  });
}

/** One line of script for an action (without indentation). */
export function actionCode(a: CaptureAction): string[] {
  const note = `// ${a.id} · ${describeAction(a).replace(/\n/g, ' ')}${a.shot ? ` · shots/${a.shot}` : ''}`;
  const out = [note];
  if (needsReview(a)) out.push(`// review: ${reviewNote(a)}`);
  else if ('locators' in a && a.locators[0] && a.locators[0].count > 1)
    out.push(`// matched ${a.locators[0].count} elements when captured`);
  switch (a.kind) {
    case 'click': {
      const opts = [`description: ${q(descriptionOf(a))}`];
      if (a.button === 'right') opts.push("button: 'right'");
      if (a.double) opts.push('double: true');
      out.push(`await tut.click(${targetCode(a)}, { ${opts.join(', ')} });`);
      return out;
    }
    case 'hover':
      out.push(`await tut.hover(${targetCode(a)}, { description: ${q(descriptionOf(a))} });`);
      return out;
    case 'scroll':
      out.push(
        `await tut.scroll(${targetCode(a)}, ${a.dy}, { ${a.dx ? `dx: ${a.dx}, ` : ''}description: ${q(descriptionOf(a))} });`,
      );
      return out;
    case 'drag':
      out.push(
        `await tut.drag(${targetCode(a)}, ${targetCode(a.to)}, { description: ${q(descriptionOf(a))} });`,
      );
      return out;
    case 'keys':
      out.push(`await page.keyboard.type(${q(a.text)});`);
      return out;
    case 'type': {
      const opts = [`description: ${q(descriptionOf(a))}`];
      if (a.clear) opts.push('clear: true');
      if (a.insert) opts.push('insert: true');
      if (a.secret) out.push('// TODO: a password field; the value was not captured');
      out.push(`await tut.type(${targetCode(a)}, ${q(a.text)}, { ${opts.join(', ')} });`);
      return out;
    }
    case 'press':
      out.push(`await tut.press(${q(a.key)});`);
      return out;
  }
}

/** Why an action needs the agent's judgement, for the draft's comment. */
function reviewNote(a: CaptureAction): string {
  switch (a.kind) {
    case 'hover':
      return 'keep only if it reveals what comes next or shows something on camera';
    case 'scroll':
      return 'keep only if the viewer should see the scroll; clicks scroll to their targets themselves';
    case 'drag':
      return 'a drag: check both ends in the marked shot';
    default: {
      const best = 'locators' in a ? a.locators[0] : undefined;
      return !best
        ? 'no locator was captured: use the marked shot'
        : best.count > 1
          ? `matched ${best.count} elements when captured: check the marked shot`
          : 'found by a CSS path or position: check the marked shot and prefer a role or text';
    }
  }
}

/**
 * A draft script.spec.ts from a capture: every action in one step, raw locators. The agent's
 * `from_capture` stage splits it into steps and swaps in the skill's page objects.
 */
export function captureToScript(
  actions: CaptureAction[],
  fixture: ScriptFixture,
  opts: { title: string; capturedAt: string },
): string {
  const body = scriptActions(actions).flatMap(actionCode);
  const uses = body.join('\n');
  const ctx = [
    'tut',
    ...(/\bpage\./.test(uses) ? ['page'] : []),
    ...(uses.includes('webview()') ? ['webview'] : []),
  ];
  return [
    '/**',
    ` * ${opts.title}: draft generated from a demo captured on ${opts.capturedAt}.`,
    ' * Locators are as captured; the from_capture stage splits the steps and tidies them.',
    ' */',
    "import type { ScriptFixture, TutorialScript } from '@studio/recorder/node';",
    '',
    `export const fixture: ScriptFixture = ${JSON.stringify(fixture, null, 2)};`,
    '',
    `const script: TutorialScript = async ({ ${ctx.join(', ')} }) => {`,
    `  await tut.step('s1', 'Demo', async () => {`,
    ...(body.length ? body.map((l) => `    ${l}`) : ['    // Nothing was captured.']),
    '  });',
    '};',
    '',
    'export default script;',
    '',
  ].join('\n');
}
