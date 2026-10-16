import type { Plan } from '@studio/core';

/**
 * The messages the pipeline sends into the agent session, one per agent stage. Each names the
 * stage, says what "done" means, and ends with the `stage_done` call the machine waits for.
 */

const done = (stage: string) =>
  `When you have finished, call the studio tool stage_done with {"stage": "${stage}", "summary": "<one or two sentences>"}. If you changed a skill, add "knowledge": "<one line: what you learned>" and don't commit it yourself: the pipeline commits skill changes after each stage. If you cannot finish, call it with "ok": false and say what is blocking you.`;

export function planInstruction(): string {
  return [
    '[Pipeline · plan]',
    "Plan this tutorial. Read the brief in this project's CLAUDE.md and the product skill, then follow the tutorial-authoring skill to split it into 3–8 steps.",
    'Save the plan with the studio tool save_plan: for each step an id (s1, s2, …), a short imperative title, what happens on screen, and draft narration. Propose explainers only where a concept is easier to show than to click through.',
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

export function postInstruction(): string {
  return [
    '[Pipeline · post-production]',
    "The take is recorded. Write the narration for each recorded step: read them with list_steps, then set each step's narration with apply_timeline_patch (replace /steps/<index>/narration).",
    "Follow the narration style in the tutorial-authoring skill, start from the plan's draft narration, and fit each step's length at about 2.5 words per second.",
    done('post'),
  ].join('\n\n');
}

export function nudge(stage: string): string {
  return `[Pipeline] Your turn ended while the pipeline is still waiting for the "${stage}" stage. Continue it, then call stage_done. If you are blocked, call stage_done with "ok": false and explain.`;
}
