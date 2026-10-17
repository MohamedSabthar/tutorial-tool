import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import plugin, { determinismRules } from '../eslint-plugin/index';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.tsx'],
      languageOptions: { parser: tseslint.parser as never, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { studio: plugin },
      rules: determinismRules,
    },
  ],
});
const lint = async (code: string) =>
  (await eslint.lintText(code, { filePath: 'Overlay.tsx' }))[0]!.messages.map((m) => m.ruleId);

describe('overlay determinism lint rules', () => {
  it('flags clocks, randomness, timers, network and CSS motion', async () => {
    const ids = await lint(`
      export default function Bad() {
        const a = Date.now() + performance.now() + new Date().getTime();
        const b = Math.random() + window.Math.random();
        setTimeout(() => {}, 10); requestAnimationFrame(() => {});
        void fetch('/x'); void import('./other');
        const css = \`@keyframes spin { to { transform: rotate(1turn) } }\`;
        return <div style={{ transition: 'opacity 0.3s', animationName: 'spin' }}>{a + b}{css}</div>;
      }`);
    expect(ids.filter((x) => x === 'studio/no-clock')).toHaveLength(3);
    expect(ids.filter((x) => x === 'studio/no-random')).toHaveLength(2);
    expect(ids.filter((x) => x === 'studio/no-timers')).toHaveLength(2);
    expect(ids.filter((x) => x === 'studio/no-network')).toHaveLength(2);
    expect(ids.filter((x) => x === 'studio/no-css-motion')).toHaveLength(3);
  });

  it('accepts a time-driven overlay', async () => {
    expect(
      await lint(`
        import { useOverlayTime } from '@studio/overlay-sdk';
        export default function Good() {
          const { local } = useOverlayTime();
          const opacity = Math.min(1, local / 0.3);
          return <div style={{ opacity, transform: \`translateY(\${(1 - opacity) * 12}px)\` }}>Hi</div>;
        }`),
    ).toEqual([]);
  });
});
