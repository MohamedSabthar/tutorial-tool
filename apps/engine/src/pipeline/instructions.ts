import type { Pace, Plan, StepTiming } from '@studio/core';
import { timingLines } from '../stepTiming';

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
    "Research first: for every part of the task the product skill doesn't already cover (no page object or component note for it, or notes that may be out of date), open the live product with inspect_ui and find the screens and controls involved, and record what you learn in the skill (following skill-maintenance). Plan steps from what you saw, not from guesses.",
    `Save the plan with the studio tool save_plan: for each step an id (s1, s2, …), a short imperative title, and what happens on screen, naming the controls as they appear. Leave narration empty: it's written after the script has been dry-run, once every step is known. ${opts.explainers ? 'Propose explainers only where a concept is easier to show than to click through.' : "Don't propose explainers: the brief asks for a recording only."}`,
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
    "Before you script a step the skill doesn't cover, research it in the live product with inspect_ui (replay up to the step before it) and add page objects or notes for what you find, so the script isn't written from guesses.",
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

/**
 * The dry run shows the tutorial will run well past the brief's length: the agent shortens the
 * script before any narration is written.
 */
export function trimInstruction(input: { seconds: number; target: string; timing: StepTiming[] }): string {
  const mins = (s: number) => `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return [
    '[Pipeline · script, length budget]',
    `The dry run passed, but the tutorial will run about ${mins(input.seconds)} on camera and the brief asks for ${input.target}. Shorten it before the narration is written:`,
    timingLines(input.timing),
    [
      "1. Move what the viewer doesn't need to watch off camera: `export const setup = async (ctx) => { … }` in script.spec.ts runs after the product loads and before recording starts, with the same tut and page objects (create the extra items, fill sample data, do a repeated flow's later rounds there). The steps then start from that state.",
      "2. Merge or drop steps that don't serve the brief's goal. If the steps change, save the plan again with save_plan (ids s1, s2, … in order) and keep the script's step ids and titles matching it.",
      "3. Don't speed things up with shorter holds or waits: the recording needs them.",
      "Dry-run the script with run_script until it passes. If it can't get shorter without losing what the brief asks for, say why in your stage_done summary; the pipeline goes on.",
    ].join('\n'),
    done('script'),
  ].join('\n\n');
}

/**
 * Voice-first recording: after a passing dry run the agent writes the final narration and ties
 * the script's actions to its words; the pipeline then voices it and records paced to it.
 */
export function narrateInstruction(plan: Plan, timing: StepTiming[] = []): string {
  return [
    '[Pipeline · narrate]',
    'The dry run passed, so you know what the script does on screen. Write the final narration and tie the actions to it: the pipeline voices this narration before recording, and the recorder paces the take to the voice-over.',
    timing.length
      ? `How long each step will take on camera, measured in the dry run (the product's own time) with the recorder's pacing added:\n${timingLines(timing)}`
      : '',
    timing.length ? NARRATION_LENGTH : '',
    [
      "1. Write each step's narration now, from what you researched and what the dry run showed on screen, following the narration style in the tutorial-authoring skill. Where the plan below already has narration for a step, the user wrote it in the storyboard: keep their wording unless it no longer matches what happens on screen. Describe the actions in the order the script does them, about 2.5 words per second of action. Save it with save_plan, keeping the step ids, titles and actions.",
      "2. In script.spec.ts, give each action the viewer should see happen on a word a cue: `tut.cue('Create')` right before the call (this works before a page-object call too: its first click or key press takes the cue), or the `cue` option of tut.click, tut.type and tut.press. A cue is a word or short phrase copied from that step's narration, usually the control's name as spoken. Cues in a step follow the narration's order. Actions without a cue run at their own pace, and every step lasts at least its line.",
      "3. Don't change what the script does. Don't record: the pipeline voices the narration, then dry-runs the script to check every cue.",
    ].join('\n'),
    plan.steps.map((s) => `- ${s.id} ${s.title}: ${s.narration || '(none)'}`).join('\n'),
    done('narrate'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** How long a line should be for its step, and what happens to the time it doesn't cover. */
const NARRATION_LENGTH = [
  'Size every line to its step, at about 2.5 words a second:',
  "- A line covers the step's time on camera, give or take 20%. Post-production keeps the voiced part as recorded, then fast-forwards whatever runs on after the line ends (a badge shows it), so anything the viewer should follow must happen while the line is speaking.",
  '- A product wait inside the step (listed above): talk through it, saying what the product is doing, and put the cue of the next action on a word that comes after the wait. Or end the line before it, and the wait is fast-forwarded.',
  '- A step that is much longer than anything worth saying (the same flow repeated, a long list of fields): narrate the first time in full and the rest in one sentence ("Add the other three tools the same way"); the rest is fast-forwarded. If it is long enough to bore even at 4×, say so in your stage_done summary: it\'s better done in the fixture or cut.',
].join('\n');

/**
 * After the voice-over: the agent sees each line's real length and ElevenLabs' word timings and
 * fits the script to them (cues, holds, waits). The approved narration doesn't change.
 */
export function alignInstruction(plan: Plan, pace: Pace, timing: StepTiming[] = []): string {
  const steps = plan.steps
    .map((s) => {
      const line = pace.steps[s.id];
      const t = timing.find((x) => x.id === s.id);
      const onCamera = t
        ? ` · about ${Math.round(t.recorded)} s on camera${t.waits.length ? ` (product waits: ${t.waits.map((w) => `${w.seconds} s after ${w.after}`).join(', ')})` : ''}`
        : '';
      if (!line) return `- ${s.id} ${s.title}: no voice line${onCamera}`;
      const words = line.words.map((w) => `${w.w}@${w.start.toFixed(1)}`).join(' ');
      return `- ${s.id} ${s.title} · line ${line.duration.toFixed(1)} s${onCamera}\n  ${words}`;
    })
    .join('\n');
  return [
    '[Pipeline · align]',
    `The narration is approved and voiced. Each line below has its length and ElevenLabs' word timings (word@seconds from the start of the line; the line starts ${pace.leadIn} s into its step). The recorder lands a cued action as its word starts, and each step lasts at least its line plus ${pace.tail} s.`,
    steps,
    [
      'Read script.spec.ts and fit it to these timings:',
      "1. Every cue must be a word of its step's line, in order, placed on the word that names the action.",
      '2. A pointer move takes 0.2–0.75 s, typing about 14 characters a second, and the product needs time to respond: if an action depends on a screen that is still loading at its word, cue it on a later word or wait for the screen first.',
      "3. If a line is much longer than its step's actions, add tut.hold after the action the words describe, so the screen the viewer hears about is on screen while it's described. If the actions take much longer than the line, make sure nothing important happens after the line ends without words: post-production fast-forwards it.",
      '4. A product wait (listed with its step) between two cues: put the second cue on a word that is spoken after the wait has ended, or the click lands late and the take is recorded again.',
      "Don't change the narration (it's approved) or what the script does, and don't record: the pipeline dry-runs the script to check the cues, then records.",
    ].join('\n'),
    done('align'),
  ].join('\n\n');
}

/** The user asked for changes at the narration gate: revise the narration and keep the cues in step. */
export function reviseNarrationInstruction(feedback: string): string {
  return [
    '[Pipeline · narrate revision]',
    `The user reviewed the final narration and asked for changes:\n\n${feedback}`,
    "Update the narration with save_plan (same step ids, titles and actions), following the narration style in the tutorial-authoring skill. Then update the cues in script.spec.ts so every cue is still a word or phrase of its step's narration, in order. Don't change what the script does, and don't record.",
    done('narrate'),
  ].join('\n\n');
}

/** The user edited narration lines at the gate: match the script's cues to them. */
export function syncCuesInstruction(steps: { id: string; title: string; narration: string }[]): string {
  return [
    '[Pipeline · narrate cues]',
    "The user edited the narration of these steps. Keep their wording exactly: don't call save_plan.",
    steps.map((s) => `- ${s.id} ${s.title}: ${s.narration || '(none)'}`).join('\n'),
    "Update the cues in script.spec.ts for these steps so every cue is a word or phrase of the new narration, in order; drop a cue whose word is gone or move it to the word that now names the action. Don't change what the script does, and don't record.",
    done('narrate'),
  ].join('\n\n');
}

export function postInstruction(plan: Plan | null = null, opts: { narrated?: boolean } = {}): string {
  return [
    '[Pipeline · post-production]',
    opts.narrated
      ? "The take is recorded against the final narration, which is already on the steps and voiced. Don't change it."
      : "The take is recorded. Write the narration for each recorded step: read them with list_steps, then set each step's narration with apply_timeline_patch (replace /steps/<index>/narration).",
    opts.narrated
      ? ''
      : "Follow the narration style in the tutorial-authoring skill, describe what the take shows, and fit each step's length at about 2.5 words per second.",
    plan && !opts.narrated && plan.steps.some((s) => s.narration.trim())
      ? "The user wrote narration for some steps in the storyboard; keep their wording unless it doesn't fit the step's length:\n\n" +
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

/** Final QA: the agent checks the video as it will be exported and fixes what it can. */
export function qaInstruction(): string {
  return [
    '[Pipeline · qa]',
    'Check the tutorial as it will be exported, before the user watches it. Run check_video and look at every frame in its contact sheets, as a viewer would.',
    [
      'Fix what you can with timeline patches (apply_timeline_patch), then run check_video again:',
      '- an overlay covering what is being clicked or described: move, resize or shorten it',
      '- captions over the important part of the screen: edit them, or hide captions if they get in the way throughout',
      '- secrets, emails or machine paths on screen: add a core:Blur over them for as long as they show',
      '- a zoom that cuts off its target or moves too often: adjust or remove it',
      '- voice running into the next step: run generate_voiceover again (unchanged lines come from the cache, and it re-runs the timing fit)',
      '- silence after a line at normal speed: run generate_voiceover again (its timing fit fast-forwards what runs on after a line)',
      "- a long fast-forward after a line: if the viewer needs to follow it, it needed narration (list it for the user); if not, cut the source range the viewer doesn't need from the recording scene's segments",
      "Things you can't fix from the timeline (an error dialog in the recording, a click off its word, a wrong screen) need a new take or a script change: don't record, list them in your summary for the user.",
    ].join('\n'),
    'When check_video reports nothing you can fix, finish. Your summary is the QA report: what you checked, what you fixed, and what is left for the user.',
    done('qa'),
  ].join('\n\n');
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
