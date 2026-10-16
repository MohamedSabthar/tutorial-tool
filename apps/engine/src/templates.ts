/**
 * Files written by `workspace.init` and `project.create`. The workspace is the agent's
 * knowledge base: Claude Code sessions run in `projects/<slug>/` and load the workspace
 * CLAUDE.md, the project CLAUDE.md and every skill under `.claude/skills/`.
 */
import type { Project } from '@studio/core';

export const WORKSPACE_CLAUDE_MD = `# Tutorial Studio workspace

This folder is the knowledge base for recording WSO2 product tutorials. Each tutorial is a
project under \`projects/<slug>/\`; you run inside one project at a time.

## How you work here
- Change the tutorial only through the \`studio\` MCP tools (timeline patches, scripts,
  voice-over). Never edit \`tutorial.json\` by hand.
- Before writing a Playwright script, read the product skill under \`.claude/skills/\`
  and reuse its page objects. Research the live UI only when a dry run fails.
- When you learn something about a product, update its skill. Put lessons that apply to
  every tutorial in the sections below. Keep entries short and deduplicated.

## Conventions
- Narration: sentence case, second person ("you"), about 150 words per minute.
- Hold about 0.6 s after each click before the next narration line.

## Learned lessons
<!-- The agent appends short, general lessons here after each tutorial. -->

## Gotchas
<!-- Product-agnostic pitfalls (timing, flaky UI patterns, recording issues). -->
`;

/** Tools a headless session may use without asking. Tightened as later steps add tools. */
export const WORKSPACE_SETTINGS = {
  permissions: {
    allow: [
      'Read',
      'Glob',
      'Grep',
      'Edit(./**)',
      'Write(./**)',
      'Bash(git status:*)',
      'Bash(git diff:*)',
      'Bash(git log:*)',
      'Bash(git add:*)',
      'Bash(git commit:*)',
      'mcp__studio',
    ],
    deny: ['Read(./**/.env)', 'Read(./**/.env.*)', 'Bash(git push:*)', 'WebFetch'],
  },
};

export const WORKSPACE_GITIGNORE = `# Large or generated media stays out of the knowledge base history.
projects/*/recordings/
projects/*/audio/
projects/*/output/
.DS_Store
`;

export const PRODUCTS = {
  products: [
    {
      id: 'wso2-integrator',
      name: 'WSO2 Integrator',
      type: 'vscode',
      extension: 'wso2.wso2-integrator',
      skill: 'wso2-integrator',
    },
  ],
};

export const THEME_TS = `/** WSO2 brand tokens for overlays and explainer scenes (mirrors @studio/ui tokens). */
export const theme = {
  color: {
    orange: '#FF5800',
    orangeBright: '#FF3900',
    navy: '#13213B',
    navy900: '#0C1526',
    white: '#FFFFFF',
    gray50: '#F3F3F3',
    gray300: '#D7D7D7',
    ink: '#252525',
    steel: '#4F7AA3',
  },
  font: { sans: 'Inter, sans-serif', mono: 'JetBrains Mono, monospace' },
  radius: 14,
  ease: { out: 'power3.out', pop: 'back.out(1.6)', inOut: 'power2.inOut' },
  duration: { fast: 0.14, base: 0.24, enter: 0.3, exit: 0.2 },
} as const;
`;

export const README_KEEP = (what: string) => `# ${what}\n\nManaged by Tutorial Studio.\n`;

export function projectClaudeMd(p: Project): string {
  return `# ${p.title}

Product: ${p.product}

## Goal
What the viewer should be able to do after watching.

## Audience
Who this tutorial is for.

## Constraints
Anything the agent must do or avoid (ports, names, things to blur).
`;
}
