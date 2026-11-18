import type { ReactNode } from 'react';
import { Glyph, Kbd, LinkButton, Shell, ShellHeader, ShellPanel, type GlyphName } from '@studio/ui';
import { TopBar } from '../frame';
import './help.css';

/**
 * Help (Phase 13): the short version. Three steps to a video, how editing works, the words the
 * app uses, and the keys. The old long guide stays in dev builds at `#/guide-classic`.
 */

const STEPS: { icon: GlyphName; title: string; text: ReactNode }[] = [
  {
    icon: 'send',
    title: '1. Say what the viewer should learn',
    text: (
      <>
        On <b>Tutorials</b>, describe the task and pick the product. Choose who clicks through it: the agent, or you once
        while it watches. Length, voice and notes are under <b>Length, voice and notes</b>.
      </>
    ),
  },
  {
    icon: 'mic',
    title: '2. Check the script',
    text: (
      <>
        The agent plans the steps and tests them in the product. When the words are ready it stops and asks you to{' '}
        <b>check the script</b>: edit any line, then <b>Approve and record</b>. You get a notification, so you can do
        something else meanwhile.
      </>
    ),
  },
  {
    icon: 'film',
    title: '3. Polish it and export',
    text: (
      <>
        When it's ready, <b>Watch and edit</b> opens the editor. Fix anything, then <b>Export</b> for the video,
        captions and a step-by-step doc.
      </>
    ),
  },
];

const EDITING: { icon: GlyphName; title: string; text: ReactNode }[] = [
  {
    icon: 'wand',
    title: 'Fix this moment',
    text: 'Pause where something is wrong and press Fix this moment. Pick what you want (or press its letter): change the words, point something out, add a label or callout, zoom in, hide something, speed up or skip, hold the frame, cut a part out, or ask the agent.',
  },
  {
    icon: 'mic',
    title: "What's said",
    text: "The right-hand panel follows the step you're on. Edit its words and press Re-voice this line; only that line is voiced again.",
  },
  {
    icon: 'timeline',
    title: 'Timeline',
    text: "Under the video: drag a step's edge to trim it, drag a voice-over line to move it, and drag an arrow, label or blur to move it or its ends to change how long it shows.",
  },
  {
    icon: 'plus',
    title: 'Effects',
    text: 'In the step panel, + Add puts something on screen at the playhead: an arrow, box, highlight or callout, a zoom into an area you drag over, a label, keys or a title card, a blur, or one of your own overlays.',
  },
  {
    icon: 'pause',
    title: 'Freezes and cuts',
    text: 'Fix this moment → Hold this frame freezes the picture for 2 s; Cut a part out takes out what you mark on the timeline. Click a piece on the Recording track (or a speed or freeze tag under the steps) to change its speed, its length, or remove it.',
  },
  {
    icon: 'film',
    title: 'Explainers and transitions',
    text: 'Hover between two steps on the timeline and press + to add an explainer, picking a look or describing it to the agent. On the Recording track, the diamond where two scenes meet sets the transition between them.',
  },
  {
    icon: 'gauge',
    title: 'Automatic edits',
    text: 'Under ⋯: rebuild the cursor, clicks and zooms from the recording, or line up the clicks with the voice. Both keep what you set by hand and can be undone.',
  },
  {
    icon: 'spark',
    title: 'Ask the agent',
    text: 'Type any change under the video, or drop pins on the video first, each with its own note, and send them as one batch. You see what it is doing while it works, and the result comes back with Keep, Undo this and Tell it more.',
  },
  {
    icon: 'undo',
    title: 'Nothing is final',
    text: 'Every change, yours or the agent’s, is in Changes and can be undone.',
  },
];

const WORDS: [string, string][] = [
  ['Tutorial', 'One video and everything made with it.'],
  ['Series', 'Tutorials in order, where each one starts where the last ended.'],
  ['Step', 'One thing the viewer does, like "Add a sum tool".'],
  ['Script', 'What the narrator says, one line per step.'],
  ['Voice-over', 'The spoken audio, made from the script.'],
  ['Recording', 'The screen capture of the product.'],
  ['Explainer', 'A short animated scene that explains an idea.'],
  ['Overlay', 'An arrow, box, label, blur or callout on the video.'],
  ['Check the script / Check the steps', 'Points where making a tutorial stops for you to review.'],
];

const KEYS: [ReactNode, string][] = [
  [<Kbd key="s">Space</Kbd>, 'Play or pause'],
  [<Kbd key="f">F</Kbd>, 'Fix this moment: the list of everything below'],
  [
    <span key="fl" className="help-keys">
      <Kbd>S</Kbd> <Kbd>A</Kbd> <Kbd>T</Kbd> <Kbd>C</Kbd> <Kbd>Z</Kbd> <Kbd>H</Kbd>
    </span>,
    "One key each, while watching: S change what's said, A arrow, T label, C callout, Z zoom, H hide",
  ],
  [
    <span key="fl2" className="help-keys">
      <Kbd>P</Kbd> <Kbd>R</Kbd> <Kbd>X</Kbd> <Kbd>N</Kbd> <Kbd>Q</Kbd>
    </span>,
    'P pace (faster or skip), R hold the frame, X cut a part out, N note for the agent, Q ask the agent',
  ],
  [
    <span key="jkl" className="help-keys">
      <Kbd>J</Kbd> <Kbd>K</Kbd> <Kbd>L</Kbd>
    </span>,
    'Back a second, pause, forward a second',
  ],
  [
    <span key="lr" className="help-keys">
      <Kbd>←</Kbd> <Kbd>→</Kbd>
    </span>,
    'One frame back or forward; on a timeline bar, move it (Shift for smaller steps)',
  ],
  [
    <span key="z" className="help-keys">
      <Kbd>⌘</Kbd> <Kbd>Z</Kbd>
    </span>,
    'Undo (add Shift to redo)',
  ],
  [<Kbd key="d">Delete</Kbd>, 'Remove the selected overlay'],
];

export function HelpScreen() {
  return (
    <div className="app-frame">
      <TopBar current="help" />
      <div className="app-frame-body">
        <main className="help">
          <header className="help-hero">
            <h1>How Tutorial Studio works</h1>
            <p>
              You describe a task. An agent plans it, tries it in the product, writes the script and records a narrated
              video. You check the script once, then polish and export.
            </p>
          </header>

          <section aria-labelledby="help-steps" className="help-steps">
            <h2 id="help-steps" className="ui-sr-only">
              Three steps to a video
            </h2>
            {STEPS.map((s) => (
              <Shell key={s.title}>
                <ShellPanel className="help-step">
                  <span className="help-step-icon" aria-hidden="true">
                    <Glyph name={s.icon} size={18} />
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </ShellPanel>
              </Shell>
            ))}
          </section>

          <Shell>
            <ShellHeader icon="wand" title="Editing" subtitle="Everything happens on one screen, step by step." />
            <ShellPanel className="help-list">
              {EDITING.map((e) => (
                <div key={e.title} className="help-row">
                  <span className="help-row-icon" aria-hidden="true">
                    <Glyph name={e.icon} size={15} />
                  </span>
                  <div>
                    <h3>{e.title}</h3>
                    <p>{e.text}</p>
                  </div>
                </div>
              ))}
            </ShellPanel>
          </Shell>

          <div className="help-two">
            <Shell>
              <ShellHeader icon="label" title="Words the app uses" />
              <ShellPanel>
                <dl className="help-words">
                  {WORDS.map(([w, d]) => (
                    <div key={w}>
                      <dt>{w}</dt>
                      <dd>{d}</dd>
                    </div>
                  ))}
                </dl>
              </ShellPanel>
            </Shell>
            <Shell>
              <ShellHeader icon="dots" title="Keys in the editor" />
              <ShellPanel>
                <dl className="help-words">
                  {KEYS.map(([k, d], i) => (
                    <div key={i}>
                      <dt>{k}</dt>
                      <dd>{d}</dd>
                    </div>
                  ))}
                </dl>
              </ShellPanel>
            </Shell>
          </div>

          <Shell>
            <ShellHeader
              icon="gear"
              title="Setting up"
              subtitle="Settings has a checklist: Claude Code, the voice-over key and the product. Each item says how to fix it."
              aside={
                <LinkButton variant="secondary" size="sm" href="#/settings">
                  Open Settings
                </LinkButton>
              }
            />
          </Shell>
        </main>
      </div>
    </div>
  );
}
