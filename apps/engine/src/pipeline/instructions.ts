import type { Plan } from '@studio/core';

/**
 * The messages the pipeline sends into the agent session, one per agent stage. Each names the
 * stage, says what "done" means, and ends with the `stage_done` call the machine waits for.
 */

const done = (stage: string) =>
  `When you have finished, call the studio tool stage_done with {"stage": "${stage}", "summary": "<one or two sentences>"}. If you changed a skill, add "knowledge": "<one line: what you learned>" and don't commit it yourself: the pipeline commits skill changes after each stage. If you cannot finish, call it with "ok": false and say what is blocking you.`;

export function planInstruction(opts: { explainers: boolean } = { explainers: true }): string {
  return [
    '[Pipeline · plan]',
    "Plan this tutorial. Read the brief in this project's CLAUDE.md (and any files it lists under References) and the product skill, then follow the tutorial-authoring skill to split it into 3–8 steps. Fit the length and style the brief asks for.",
    `Save the plan with the studio tool save_plan: for each step an id (s1, s2, …), a short imperative title, what happens on screen, and draft narration. ${opts.explainers ? 'Propose explainers only where a concept is easier to show than to click through.' : "Don't propose explainers: the brief asks for a recording only."}`,
    "Don't write or run the script yet; the user reviews the plan first.",
    done('plan'),
  ].join('\n\n');
}

export function reviseInstruction(feedback: string): string {
  return [
    '[Pipeline · plan revision]',
    `The user reviewed the plan and asked for changes:\n\n${feedback}`,
    'Update the plan with save_plan. Keep step ids in order (s1, s2, …).',
    done('plan'),
  ].join('\n\n');
}

export function scriptInstruction(plan: Plan): string {
  return [
    '[Pipeline · script]',
    "Write script.spec.ts in this project for the approved plan below, following the tutorial-authoring skill: reuse the product skill's page objects, and use exactly these step ids and titles.",
    "You may dry-run it with run_script while you work, but you don't have to: the pipeline dry-runs it as soon as you finish. Don't record.",
    '```json\n' + JSON.stringify(plan.steps, null, 2) + '\n```',
    done('script'),
  ].join('\n\n');
}

export function repairInstruction(input: {
  attempt: number;
  max: number;
  mode: 'dry' | 'record';
  stepId: string | null;
  error: string;
  errorDetail?: string;
  feedback?: string;
}): string {
  return [
    `[Pipeline · repair, attempt ${input.attempt} of ${input.max}]`,
    `The ${input.mode === 'dry' ? 'dry run' : 'recording'} failed${input.stepId ? ` at step ${input.stepId}` : ''}: ${input.error}`,
    input.errorDetail ? '```\n' + input.errorDetail + '\n```' : '',
    input.feedback ? `The user adds:\n\n${input.feedback}` : '',
    'Fix it by following the skill-maintenance skill: read the failure (run_script({"mode": "dry"}) shows the screenshot and ARIA snapshots), research with inspect_ui only if that isn\'t enough, then fix the page objects or the script and update the skill notes. Check with a dry run before you finish.',
    done('repair'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function postInstruction(plan: Plan | null = null): string {
  return [
    '[Pipeline · post-production]',
    "The take is recorded. Write the narration for each recorded step: read them with list_steps, then set each step's narration with apply_timeline_patch (replace /steps/<index>/narration).",
    "Follow the narration style in the tutorial-authoring skill, start from the plan's draft narration, and fit each step's length at about 2.5 words per second.",
    plan
      ? "The user reviewed this narration in the storyboard and may have edited it; keep their wording unless it doesn't fit the step's length:\n\n" +
        plan.steps.map((s) => `- ${s.id} ${s.title}: ${s.narration || '(none)'}`).join('\n')
      : '',
    plan?.explainers.length
      ? 'The approved plan also proposes explainers. For each, call insert_explainer at the end of the step it follows (get_timeline gives step times), with the idea as the brief, and write its storyboard; stop there for each, the user approves storyboards in the Studio:\n\n' +
        plan.explainers.map((e) => `- after ${e.after}: ${e.idea}`).join('\n')
      : '',
    done('post'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function retroInstruction(input: {
  history: { stage: string; ok: boolean | null; summary: string }[];
  claudeMdBytes: number;
  feedback?: string;
}): string {
  const log = input.history
    .map((h) => `- ${h.stage}: ${h.ok === false ? 'FAILED' : 'ok'}${h.summary ? ` · ${h.summary}` : ''}`)
    .join('\n');
  return [
    '[Pipeline · retro]',
    'The tutorial is recorded. Review this run so the next tutorial goes faster:',
    log,
    input.feedback ? `The user reviewed your previous retrospective and says:\n\n${input.feedback}` : '',
    [
      'Then:',
      '1. Product facts you confirmed or corrected (labels, flows, timings, gotchas) go into the product skill (components/*.md, pages/*.ts, SKILL.md), following skill-maintenance.',
      '2. Lessons that apply to every tutorial go into the workspace CLAUDE.md under "Learned lessons" or "Gotchas": at most 3, one line each, only if new. Merge or replace existing lines instead of repeating them.',
      `3. Keep the workspace CLAUDE.md under 8 KB (it is ${input.claudeMdBytes} bytes now).`,
      '4. If this tutorial produced an overlay or scene worth reusing, say which in your summary (promotion arrives later).',
      "If nothing is worth recording, change nothing and say so. Don't commit: the user reviews the diff, then it is committed.",
    ].join('\n'),
    'When you have finished, call the studio tool stage_done with {"stage": "retro", "summary": "<what you recorded, and any overlays worth promoting>", "knowledge": "<one line for the commit message>"}.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function nudge(stage: string): string {
  return `[Pipeline] Your turn ended while the pipeline is still waiting for the "${stage}" stage. Continue it, then call stage_done. If you are blocked, call stage_done with "ok": false and explain.`;
}
