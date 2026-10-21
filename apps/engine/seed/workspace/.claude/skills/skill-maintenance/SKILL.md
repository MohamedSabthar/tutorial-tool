---
name: skill-maintenance
description: When and how to research a product's live UI and update its skill (components/*.md and pages/*.ts) so later tutorials don't need research. Read when a dry run fails because the UI differs from the skill, or after learning a new product fact.
---

# Keeping product skills current

Product skills (`.claude/skills/<product>/`) are the memory that makes tutorials fast: a script
built from verified page objects passes its first dry run without research. Keep them accurate.

## When to research

- **Only after a dry run fails** at a step whose page objects look right, or when the brief needs a
  component the skill doesn't cover yet.
- Read the failure first: `run_script` returns the error, Playwright's call log, a screenshot and
  ARIA snapshots. If they already show the fix (a renamed label, a moved button), make it without
  opening the product.
- Otherwise use `inspect_ui`:
  1. `uptoStep: '<failing step>'` replays the steps before it.
  2. `actions` performs the failing step's earlier clicks.
  3. `probes` tests candidate locators. Pick the one with exactly one visible match.
- Prefer, in order: `getByRole(role, { name })`, `getByPlaceholder`, `getByText(..., { exact: true })`,
  `getByTestId`. Avoid CSS classes and nth-child positions; they break on every release.

## How to update

1. **`pages/<component>.ts`:** fix or add the locator or helper. Keep helpers small and named for
   what the viewer does (`addResource(ctx, 'GET', 'hello')`). Update the verified-with version in
   the file comment when you verify it.
2. **`components/<component>.md`:** fix the flow description, note the change under the step it
   affects, and update the front matter:
   ```yaml
   product_version: 1.127.0        # from the run's start marker or the About dialog
   last_verified: 2026-10-16
   ```
3. **`SKILL.md`:** add a component row or a gotcha when it applies beyond one component.
4. **Deduplicate.** Replace outdated text instead of appending contradictions. One fact, one place.
5. **Dry-run again** until it passes.
6. **Commit** the skill change in the workspace repo with a structured message:
   ```
   skills(wso2-integrator): http-service resource path field renamed [1.127.0]
   ```
   - **In a pipeline stage** (a `[Pipeline · …]` message): don't commit. Pass the one-line
     description as `knowledge` in `stage_done`; the pipeline commits the skill files with it.
   - **Otherwise:** commit yourself with one command from your working directory (no `cd`, no
     heredoc): `git add ../../.claude/skills/<product>` then
     `git commit -m "skills(<product>): … [<version>]" -- ../../.claude/skills/<product>`.
     Stage only skill files, never recordings.

## What not to put in a skill

- Tutorial-specific content (names from one brief, narration). That belongs in the project.
- Guesses. Only record what a passing run or a probe confirmed.
- Long logs or snapshots. Summarise the fact and the locator.
