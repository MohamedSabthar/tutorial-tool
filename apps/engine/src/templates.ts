/**
 * Files written by `workspace.init` and `project.create`. The workspace is the agent's
 * knowledge base: Claude Code sessions run in `projects/<slug>/` and load the workspace
 * CLAUDE.md, the project CLAUDE.md and every skill under `.claude/skills/`.
 */
import type { Project } from '@studio/core';

export const WORKSPACE_CLAUDE_MD = `# Tutorial Studio workspace

This folder is the knowledge base for recording WSO2 product tutorials. Each tutorial is a
project under \`projects/<slug>/\`; you run inside one project at a time, and its \`CLAUDE.md\`
is the brief.

## How you work here
- Change the tutorial only through the \`studio\` MCP tools: \`get_timeline\`, \`list_steps\` and
  \`capture_frame\` to read it, \`apply_timeline_patch\` to change it, \`run_script\` to dry-run or
  record, \`inspect_ui\` to research the live product. Never edit \`tutorial.json\` by hand.
- Skills under \`.claude/skills/\`:
  - \`tutorial-authoring\`: planning steps, writing \`script.spec.ts\` with \`tut\`, pacing, narration.
  - \`skill-maintenance\`: when to research the UI and how to update product skills.
  - \`vscode-platform\`: generic VS Code workbench automation.
  - \`overlay-authoring\`: writing overlay components.
  - One folder per product (e.g. \`wso2-integrator\`) with page objects in \`pages/\` and
    verified flows in \`components/\`.
- Build scripts from the product skill's page objects. Research the live UI only when a dry run
  fails, then fix the skill so the next tutorial doesn't need research.
- Dry-run before every recording. Never record a script that hasn't passed a dry run.
- When you learn something about a product, update its skill. Put lessons that apply to every
  tutorial in the sections below. Keep entries short and deduplicated.

## Conventions
- Narration: sentence case, second person ("you"), about 150 words per minute.
- Hold about 0.6–1 s after each click before the next action; 1–1.5 s after big screen changes.
- Step ids \`s1\`, \`s2\`, … in order; step titles are short imperative sentences.
- Workspace commits: \`skills(<product>): <what changed> [<product version>]\`,
  \`overlays: …\`, \`lessons: …\`. Never push.

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
projects/*/.studio/
.studio/
.DS_Store
`;

export const PRODUCTS = {
  products: [
    {
      id: 'wso2-integrator',
      name: 'WSO2 Integrator',
      type: 'vscode-app',
      app: '/Applications/WSO2 Integrator.app',
      skill: 'wso2-integrator',
      projectStructure: 'BI: root Ballerina.toml with [workspace] + one [package] folder per integration',
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
Who this tutorial is for and what they already know.

## Outline
The steps, once planned (one line each). Proposed explainers go here too.

## Constraints
Anything the agent must do or avoid (names, ports, things to blur, features to skip).

## Notes
Decisions made while producing this tutorial.
`;
}
