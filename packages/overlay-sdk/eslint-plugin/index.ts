import type { ESLint, Rule } from 'eslint';

/**
 * Determinism rules for overlays and scenes. A component must be a pure function of time
 * (`useOverlayTime`), so the preview, a scrub and the export draw the same frame for the same t.
 * Clocks, randomness, timers, network access and CSS motion all break that.
 */

type Node = Rule.Node & Record<string, unknown>;

const nameOf = (n: Node | undefined) =>
  !n ? null : n.type === 'Identifier' ? (n.name as string) : n.type === 'Literal' ? String(n.value) : null;

/** `object.property`, also through a global (`window.Date.now`, `globalThis.Math.random`). */
const member = (node: Node, object: string, property: string) => {
  if (node.type !== 'MemberExpression') return false;
  const o = node.object as Node;
  const objectName = o.type === 'MemberExpression' ? nameOf(o.property as Node) : nameOf(o);
  return objectName === object && nameOf(node.property as Node) === property;
};

const rule = (description: string, create: Rule.RuleModule['create']): Rule.RuleModule => ({
  meta: { type: 'problem', docs: { description }, schema: [] },
  create,
});

const noClock = rule('No clocks: use useOverlayTime() for time', (context) => ({
  MemberExpression(node) {
    const n = node as Node;
    if (member(n, 'Date', 'now') || member(n, 'performance', 'now'))
      context.report({
        node,
        message: `${context.sourceCode.getText(node)} reads the clock; derive everything from useOverlayTime() so a frame depends only on t.`,
      });
  },
  NewExpression(node) {
    const callee = (node as Node).callee as Node;
    if (callee.type === 'Identifier' && callee.name === 'Date')
      context.report({
        node,
        message:
          'new Date() reads the clock; derive everything from useOverlayTime() so a frame depends only on t.',
      });
  },
  CallExpression(node) {
    const callee = (node as Node).callee as Node;
    if (callee.type === 'Identifier' && callee.name === 'Date')
      context.report({ node, message: 'Date() reads the clock; use useOverlayTime().' });
  },
}));

const noRandom = rule('No unseeded randomness', (context) => ({
  MemberExpression(node) {
    const n = node as Node;
    if (
      member(n, 'Math', 'random') ||
      member(n, 'crypto', 'getRandomValues') ||
      member(n, 'crypto', 'randomUUID')
    )
      context.report({
        node,
        message: `${context.sourceCode.getText(node)} differs on every render; use a fixed seed (e.g. a small hash of the overlay id) instead.`,
      });
  },
}));

const TIMERS = new Set([
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'requestIdleCallback',
  'queueMicrotask',
]);
const noTimers = rule('No timers or animation frames', (context) => ({
  CallExpression(node) {
    const callee = (node as Node).callee as Node;
    const name =
      callee.type === 'Identifier'
        ? (callee.name as string)
        : callee.type === 'MemberExpression' && (callee.property as Node).type === 'Identifier'
          ? ((callee.property as Node).name as string)
          : null;
    if (name && TIMERS.has(name))
      context.report({
        node,
        message: `${name} runs on wall-clock time; animate from useOverlayTime() (or useGsap, which seeks to t).`,
      });
  },
}));

const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);
const noNetwork = rule('No network access while rendering', (context) => ({
  Identifier(node) {
    const n = node as Node;
    const parent = n.parent as Node | undefined;
    if (!NETWORK.has(n.name as string)) return;
    if (parent?.type === 'MemberExpression' && parent.property === n && !(parent as Node).computed) return;
    if (parent?.type === 'Property' && parent.key === n) return;
    if (
      parent &&
      (parent.type === 'CallExpression' || parent.type === 'NewExpression') &&
      parent.callee === n
    )
      context.report({
        node,
        message: `${n.name as string} makes rendering depend on the network; pass data in through props.`,
      });
  },
  ImportExpression(node) {
    context.report({
      node,
      message: 'A dynamic import() loads code at render time; import statically at the top of the file.',
    });
  },
}));

const MOTION_KEYS =
  /^(animation|transition)(Name|Duration|Delay|TimingFunction|IterationCount|Property|Direction|FillMode|PlayState)?$/;
const MOTION_CSS = /@keyframes|(^|[;{\s])(animation|transition)(-[a-z-]+)?\s*:/;
const noCssMotion = rule('No CSS animations or transitions', (context) => ({
  Property(node) {
    const key = (node as Node).key as Node;
    const name =
      key.type === 'Identifier' ? (key.name as string) : key.type === 'Literal' ? String(key.value) : '';
    if (MOTION_KEYS.test(name))
      context.report({
        node,
        message: `CSS ${name} plays on its own clock; compute the style from useOverlayTime() instead.`,
      });
  },
  Literal(node) {
    const v = (node as Node).value;
    if (typeof v === 'string' && MOTION_CSS.test(v))
      context.report({
        node,
        message:
          'CSS animations and transitions play on their own clock; compute styles from useOverlayTime().',
      });
  },
  TemplateElement(node) {
    const v = ((node as Node).value as { raw: string }).raw;
    if (MOTION_CSS.test(v))
      context.report({
        node,
        message:
          'CSS animations and transitions play on their own clock; compute styles from useOverlayTime().',
      });
  },
}));

const plugin: ESLint.Plugin = {
  meta: { name: '@studio/eslint-plugin-overlay', version: '0.0.0' },
  rules: {
    'no-clock': noClock,
    'no-random': noRandom,
    'no-timers': noTimers,
    'no-network': noNetwork,
    'no-css-motion': noCssMotion,
  },
};

/** All determinism rules as errors. */
export const determinismRules = {
  'studio/no-clock': 'error',
  'studio/no-random': 'error',
  'studio/no-timers': 'error',
  'studio/no-network': 'error',
  'studio/no-css-motion': 'error',
} as const;

export default plugin;
