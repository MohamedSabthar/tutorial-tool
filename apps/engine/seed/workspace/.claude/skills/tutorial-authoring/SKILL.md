---
name: tutorial-authoring
description: How to plan and write a tutorial's Playwright script (script.spec.ts) with the recorder's `tut` API, pace it for viewers, and write narration. Read before writing or changing any script.spec.ts, and before writing step narration.
---

# Writing a tutorial

A tutorial is a project folder (`projects/<slug>/`). Its brief is the project `CLAUDE.md`; the
script is `script.spec.ts`; the timeline (`tutorial.json`) changes only through the `studio`
tools. The recorder runs the script in the real product, records the screen, and logs every
click, keystroke and target box to `events.jsonl`, which drives the cursor, zooms and callouts.

## Workflow

1. **Read the product skill** (e.g. `wso2-integrator`) and reuse its page objects. Only use a raw
   locator when no page object covers the action, then add it to the skill afterwards.
2. **Research what the skill doesn't cover** with `inspect_ui` before planning or scripting it,
   and write what you find into the skill. Never plan, script or narrate a screen you haven't seen.
3. **Plan.** Turn the brief into 3–8 steps. One step is one idea the viewer can follow
   (e.g. "Create an HTTP service at /greeting"), usually 1–4 actions. Leave the narration empty:
   it's written after the dry run, when every step is known.
4. **Write `script.spec.ts`** from the template below.
5. **Dry run** with `run_script({ mode: 'dry' })`. Fix and repeat until it passes. If it fails
   because the UI is different from the skill, follow the `skill-maintenance` skill.
6. **Narrate** each step from what the dry run showed, and cue the actions (see Voice-first pacing).
7. **Record** with `run_script({ mode: 'record' })` only after a passing dry run.

## Script template

```ts
import type { ScriptFixture, TutorialScript } from '@studio/recorder/node';
import { addResource, createHttpService } from '../../.claude/skills/wso2-integrator/pages/http-service';
import { openArtifacts, overview } from '../../.claude/skills/wso2-integrator/pages/workbench';

export const fixture: ScriptFixture = {
  kind: 'bi',
  folder: 'greeting-project',
  title: 'Greeting Project',
  integrations: [{ name: 'greeting_service', title: 'Greeting Service' }],
};

const script: TutorialScript = async (ctx) => {
  const { tut } = ctx;

  await tut.step('s1', 'Open the artifact catalogue', async () => {
    await tut.waitFor(overview(ctx).addArtifactManually, 30_000);
    await tut.hold(1200);
    await openArtifacts(ctx);
    await tut.hold(800);
  });

  await tut.step('s2', 'Create an HTTP service at /greeting', async () => {
    await createHttpService(ctx, '/greeting');
    await tut.hold(1000);
  });
};

export default script;
```

Plan for it without changing what is taught: build what the brief asks for the way a developer
would (four tools stay four tools, not one merged tool to save camera time). A repeated slow flow
(several similar tools, endpoints, fields) is shown once on camera and the rest is created in
setup; a product flow over about a minute that isn't the point of the tutorial is set up off
camera. Start every step by waiting for the screen it expects, so a failure shows in the step that
caused it, not several steps later.

Work the viewer doesn't need to watch (extra items, sample data, the later rounds of a repeated
flow) goes in an optional `export const setup: TutorialScript = async (ctx) => { … }`. It runs
after the product loads and before recording starts, at dry-run speed, with the same `tut` and
page objects (wrapped in one step named "setup"); the first step starts from the state it leaves.

- Only `import type` from `@studio/recorder/node`; runtime imports are relative files (page objects).
- Step ids are `s1`, `s2`, … in order and never reused for a different step. Overlays anchor to them.
- Step titles are short imperative sentences in sentence case: they become chapter titles.
- `projects/demo-http/script.spec.ts` is a complete, verified reference.

## The `tut` API

| Call | What it does |
|---|---|
| `tut.step(id, title, async () => { … })` | A named step. A failure inside reports this step with a screenshot and ARIA snapshots. |
| `tut.click(locator, { description, cue })` | Moves the cursor along a human path and clicks. Logs the target box. |
| `tut.type(locator, text, { description, clear, insert, cue })` | Clicks the field, then types at a human pace. `clear` empties a prefilled field first; `insert` enters text in one go (code editors with auto-closing brackets). |
| `tut.press('Enter', { cue })` | A key or chord (`'Meta+Shift+P'`). Shown as a keystroke overlay. |
| `tut.cue('Create')` | The next click, typing or key press lands on this narration word. Use it before page-object calls. |
| `tut.showToasts()` / `tut.hideToasts()` | Notification toasts are hidden on camera; show them for a step that's about one. |
| `tut.hold(ms)` | Holds still so the viewer can take something in (skipped in dry runs). |
| `tut.waitFor(locator, timeoutMs?)` | Waits until visible, for slow views. Doesn't move the cursor. |
| `tut.mask(locator, label)` | Marks an area to blur in post (emails, tokens, machine paths). |

`ctx.page` is the window and `ctx.webview()` is the active webview's content frame (most
WSO2 Integrator UI). Always pass a `description` naming the control as the viewer sees it
("Create", "Resource Path"): it labels the action in Live and in captions.

## Pacing

- `tut.hold(1000–1500)` after anything that changes the screen a lot (a new editor, a form opening).
- `tut.hold(600–1000)` between ordinary actions inside a step.
- Start the first step with `waitFor` on its first control plus `hold(1200)`, so the video opens
  on a settled screen.
- Don't add holds for slow product operations: `waitFor` the result instead, and trim in post.
- Keep each step under about 20 s of recorded time; split longer ones.

## Voice-first pacing

After a passing dry run the pipeline asks for the final narration, voices it, and records the
take paced to the voice-over: every step lasts at least its line, and an action with a cue
lands as its word is spoken. So:

- Write the narration in the order the script acts, naming each control as the viewer hears it.
- Cue the actions the viewer should see on a word: `tut.cue('Create')` before the call (a
  page object's first click or key press takes it), or the `cue` option. A cue is a word or
  short phrase copied from that step's narration; cues in a step follow the narration's order.
- Leave setup actions (waits, scrolling, closing a notification) without a cue.
- A cue that isn't in the narration fails the step in the dry run that checks the cues.
- Size each line from the dry run. `run_script` in dry mode gives each step's `recordedSeconds`
  (how long it will run on camera, with the pacing a dry run skips) and its `productWaits`. Aim
  for about 2.5 words a second of that.
- A product wait inside a step: talk through it (what the product is doing) and cue the next
  action on a word spoken after the wait, or end the line before it.
- Whatever runs on after a line is fast-forwarded in post-production, with a badge: nothing the
  viewer needs to follow may happen there. A flow repeated on camera: narrate the first one, sum
  up the rest in one sentence, and let them fast-forward.

## Narration style

- Sentence case, second person ("you"), present tense, active voice.
- About 150 words per minute: a 6 s step gets one sentence of about 15 words.
- Say why before how when it isn't obvious ("A resource is an endpoint on the service.").
- Name controls exactly as they appear on screen, in the order the viewer sees them.
- No filler ("simply", "just", "go ahead and"), no exclamation marks, no "we".
- One idea per sentence. Numbers and paths as written on screen ("/greeting", "port 9090").
