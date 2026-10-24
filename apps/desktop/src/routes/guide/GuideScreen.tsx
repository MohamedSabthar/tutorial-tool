import { useEffect, type ReactNode } from 'react';
import { Title } from '@studio/ui';
import { AppFrame } from '../frame';
import settingsShot from './shots/settings.jpg';
import projectsShot from './shots/projects.jpg';
import briefShot from './shots/brief.jpg';
import storyboardShot from './shots/storyboard.jpg';
import liveShot from './shots/live.jpg';
import studioShot from './shots/studio.jpg';
import pieceShot from './shots/studio-piece.jpg';
import lineShot from './shots/studio-line.jpg';
import toolsShot from './shots/studio-tools.jpg';
import agentShot from './shots/studio-agent.jpg';
import exportShot from './shots/export.jpg';

/** Sections in reading order: id (for `#/guide?s=<id>` links), number and title. */
export const GUIDE_SECTIONS = [
  ['setup', '1', 'Before you start'],
  ['start', '2', 'Start a tutorial'],
  ['brief', '3', 'Write the brief'],
  ['storyboard', '4', 'Review the storyboard'],
  ['live', '5', 'Watch it on Live'],
  ['studio', '6', 'The Studio'],
  ['recording', '7', 'Edit the recording'],
  ['voice', '8', 'Edit the voice-over'],
  ['overlays', '9', 'Overlays and notes'],
  ['explainers', '10', 'Explainers'],
  ['agent', '11', 'Work with the agent'],
  ['export', '12', 'Export'],
  ['keys', '⌨', 'Keyboard shortcuts'],
] as const;
type SectionId = (typeof GUIDE_SECTIONS)[number][0];

/** A link to one section of the guide, for help next to the controls it explains. */
export const guideHref = (section: SectionId) => `#/guide?s=${section}`;

const show = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start' });

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const [, n, title] = GUIDE_SECTIONS.find(([s]) => s === id)!;
  return (
    <section id={`guide-${id}`} className="guide-section" aria-labelledby={`guide-${id}-h`}>
      <h2 id={`guide-${id}-h`}>
        <span className="guide-n">{n.length === 1 && n !== '⌨' ? `0${n}` : n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Shot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="guide-shot">
      <img src={src} alt={alt} width={1440} height={900} loading="lazy" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const Ui = ({ children }: { children: ReactNode }) => <span className="guide-ui">{children}</span>;
const Kbd = ({ children }: { children: ReactNode }) => <kbd className="guide-kbd">{children}</kbd>;

/** How to use Tutorial Studio, from setup to export, with screenshots of each screen. */
export function GuideScreen({ section }: { section: string | null }) {
  useEffect(() => {
    if (section) show(section);
  }, [section]);

  const go = (id: string) => {
    window.history.replaceState(null, '', `#/guide?s=${id}`);
    show(id);
  };

  return (
    <AppFrame current="guide">
      <div className="guide">
        <nav className="guide-toc" aria-label="Guide contents">
          <span className="guide-toc-head">Contents</span>
          {GUIDE_SECTIONS.map(([id, n, title]) => (
            <button key={id} type="button" onClick={() => go(id)}>
              <span>{n}</span>
              {title}
            </button>
          ))}
        </nav>

        <main className="guide-main">
          <header className="guide-intro">
            <Title size={44}>Tutorial Studio guide</Title>
            <p className="guide-lede">
              Describe a task in a WSO2 product. An agent plans the steps, records them in the real product,
              and drafts the narration, overlays and explainers. You review it at each gate and finish the
              edit in the Studio.
            </p>
            <ol className="guide-flow" aria-label="How a tutorial is made">
              {[
                ['Brief', false],
                ['Plan review', true],
                ['Script and dry run', false],
                ['Narration review', true],
                ['Record', false],
                ['Post-production', false],
                ['Edit in the Studio', false],
                ['Export', false],
              ].map(([label, gate]) => (
                <li key={label as string} data-gate={gate ? '' : undefined}>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
            <p className="guide-legend">
              <i aria-hidden="true" />
              Gates: the pipeline pauses for your approval.
            </p>
          </header>

          <Section id="setup">
            <p>
              Open <Ui>Settings</Ui> (the sun icon at the top). The <Ui>Get started</Ui> checklist shows what
              is still missing.
            </p>
            <ul>
              <li>
                <b>Claude sign-in.</b> The agent runs Claude Code with its own sign-in. Run{' '}
                <code>claude auth login</code> in Terminal, then <Ui>Check sign-in</Ui>.
              </li>
              <li>
                <b>ElevenLabs API key.</b> Needed for the voice-over. It is checked with ElevenLabs, kept in
                the macOS Keychain, and never reaches the agent.
              </li>
              <li>
                <b>Appearance.</b> System, Light or Dark. Only the app changes; videos keep their own colours.
              </li>
              <li>
                <b>New tutorials.</b> The default voice, the cost limit per run, the agent model, and how many
                repairs it tries before asking you.
              </li>
            </ul>
            <Shot
              src={settingsShot}
              alt="The Settings screen with the setup checklist, Appearance, Accounts, Pronunciations and Products"
              caption="Settings: the setup checklist, Appearance and Accounts on the left; pronunciations and products on the right."
            />
          </Section>

          <Section id="start">
            <ol>
              <li>
                On the home screen, pick the product (for example <Ui>WSO2 Integrator</Ui>).
              </li>
              <li>Describe the task in a sentence, or click one of the suggestions.</li>
              <li>
                Click <Ui>Set up tutorial</Ui>. The brief opens.
              </li>
            </ol>
            <p>
              <Ui>Recent tutorials</Ui> lists your projects with their length and state: <i>In edit</i>, or{' '}
              <i>Needs you</i> when a run is waiting for an answer.
            </p>
            <Shot
              src={projectsShot}
              alt="The home screen: product picker, task field, suggestions, the Get started checklist and recent tutorials"
              caption="The home screen. Describe the task, then Set up tutorial."
            />
          </Section>

          <Section id="brief">
            <p>
              The brief tells the agent what to teach and how. Everything here can be changed until you start.
            </p>
            <ul>
              <li>
                <b>What should the viewer learn?</b> The goal, in your words.
              </li>
              <li>
                <b>Starting workspace.</b> The project the recording starts from.
              </li>
              <li>
                <b>Audience, Length and Style.</b> New to WSO2, Developer or Architect; about 1, 2–3 or 5+
                minutes; step by step, concept first or a quick demo.
              </li>
              <li>
                <b>Voice (ElevenLabs).</b> The narrator's voice.
              </li>
              <li>
                <b>Let the agent propose explainers.</b> Short animated scenes that explain a concept.
              </li>
              <li>
                <b>Review gates.</b> Where the pipeline pauses for you, such as the storyboard review.
              </li>
              <li>
                <b>Notes for the agent</b> and <b>References</b>. Constraints ("Don't exceed 5 min"), docs, a
                VSIX or links the agent reads while planning.
              </li>
            </ul>
            <p>
              Click <Ui>Plan and record</Ui> to start, or <Ui>Save draft</Ui>.
            </p>
            <p className="guide-tip" data-tone="warn">
              <b>Choose a voice before you start.</b> With a voice, the take is recorded paced to the
              voice-over, so clicks land on their words. Without one, narration is written after recording and
              lines up less closely.
            </p>
            <Shot
              src={briefShot}
              alt="The tutorial brief form with goal, product, workspace, audience, length, style, voice and references"
              caption="The brief. The right column shows references, what the agent already knows, and what happens next."
            />
          </Section>

          <Section id="storyboard">
            <p>
              At the plan review the Storyboard shows each step, what happens on screen, and any proposed
              explainers. At the narration review it shows the final script with each step's time on camera
              from the dry run.
            </p>
            <ul>
              <li>Edit narration in place, or ask for changes in words.</li>
              <li>
                A note such as "0:06 more on camera than the line" means part of the step plays with no voice:
                it will be fast-forwarded unless the line says more.
              </li>
              <li>Approve to continue. Recording starts after the last gate.</li>
            </ul>
            <p>
              After recording, the Storyboard shows the narration as it is on the timeline. Edit it in the
              Studio.
            </p>
            <Shot
              src={storyboardShot}
              alt="The Storyboard with numbered step cards, on-camera times, narration and a proposed explainer"
              caption="The Storyboard after recording, with the steps and their time on camera."
            />
          </Section>

          <Section id="live">
            <p>
              Live follows the run while it happens: the pipeline steps, the product being driven in the{' '}
              <Ui>Live view</Ui>, and the <Ui>Agent console</Ui>.
            </p>
            <ul>
              <li>
                <b>Steer the agent.</b> Type a message to correct it mid-run.
              </li>
              <li>
                <b>Pause agent</b> and <b>Stop take</b> at the top.
              </li>
              <li>
                When a dry run fails, the agent repairs the script. After the repair limit in Settings, it
                stops and asks you a specific question.
              </li>
              <li>
                In post-production, Live lists the voice-over, the timing fit and the silent stretches the
                agent handled.
              </li>
            </ul>
            <Shot
              src={liveShot}
              alt="The Live screen with the pipeline steps, live view and agent console"
              caption="Live between runs. During a run, the product's screen streams into the Live view."
            />
          </Section>

          <Section id="studio">
            <p>
              The Studio is where you finish the tutorial. Everything is undoable, and changes save as you go.
            </p>
            <Shot
              src={studioShot}
              alt="The Studio with the step list, the preview and play bar, the Inspector and Library, and the timeline"
              caption="The Studio while an explainer scene plays."
            />
            <ul className="guide-where">
              <li>
                <b>Left panel</b>Steps (click to jump), Pipeline, Agent (chat) and Skills.
              </li>
              <li>
                <b>Preview</b>The video as it will export. The tool rail on its left adds notes and overlays.
              </li>
              <li>
                <b>Play bar</b>Seek, play, step back and forward, Captions on/off, Click sounds, the Final /
                With annotations / Raw take views, and full screen.
              </li>
              <li>
                <b>Right panel</b>The Inspector for whatever is selected, and the Library of overlays and
                explainers.
              </li>
              <li>
                <b>Timeline</b>Lanes for Scenes (recording pieces and explainers), Steps, Overlays, Camera,
                Voice-over, Captions and Annotations.
              </li>
              <li>
                <b>Review banner</b>When the agent has changed something, Review changes shows what changed.
              </li>
            </ul>
          </Section>

          <Section id="recording">
            <p>
              The Scenes lane shows the recording as pieces. Each piece plays part of the take at some speed,
              or freezes a frame.
            </p>
            <ol>
              <li>
                Move the playhead and press <Kbd>S</Kbd> (or <Ui>Split</Ui>) to cut a piece in two.
              </li>
              <li>
                Click a piece. The <Ui>Recording piece</Ui> panel opens.
              </li>
              <li>
                Change it:
                <ul>
                  <li>
                    <b>Speed</b>: 1×, 1.5×, 2×, 4×, 8×, 16×, or any value from 0.25× to 16×. Use 8× and 16×
                    only for static screens such as the product working.
                  </li>
                  <li>
                    <b>Starts at / Ends at</b>: trim or extend the piece. You can also drag its edges on the
                    timeline; they snap to clicks and step starts.
                  </li>
                  <li>
                    <b>Freeze here</b>: hold the frame under the playhead for a number of seconds.
                  </li>
                  <li>
                    <b>Remove (off camera)</b>: cut it out. A ✂ mark appears where it was; click it to put the
                    recording back.
                  </li>
                  <li>
                    <b>Loop this piece</b>: play it over and over while you adjust it.
                  </li>
                </ul>
              </li>
            </ol>
            <p>
              Sped-up pieces get a fast-forward badge in the video, and cuts get a short "skipped" badge, so
              the viewer knows the recording jumped.
            </p>
            <p className="guide-tip">
              <b>Your edits are kept.</b> A piece you edit shows a dashed outline and <i>Edited by hand</i>.
              Fit timing and Regenerate VO leave it as you set it. Click <Ui>Back to automatic</Ui> to hand it
              back.
            </p>
            <Shot
              src={pieceShot}
              alt="A selected recording piece outlined in orange on the timeline, with the Recording piece panel showing speed presets, start and end, and freeze"
              caption="A selected piece and its panel: speed, start and end in the recording, freeze at the playhead."
            />
          </Section>

          <Section id="voice">
            <p>
              Each step's narration is voiced as a line on the Voice-over lane. Captions are built from the
              lines.
            </p>
            <h3>Add a line of your own</h3>
            <ol>
              <li>Move the playhead to where the line should start.</li>
              <li>
                Click <Ui>+ Voice line</Ui>, write what the voice should say, and click{' '}
                <Ui>Voice it at the playhead</Ui>.
              </li>
            </ol>
            <p>
              Use it for a stretch that plays with no voice: the footage under your line plays at normal speed
              after the next fit.
            </p>
            <h3>Change a line</h3>
            <ul>
              <li>
                Click a line to open the <Ui>Voice line</Ui> panel: change the text and{' '}
                <Ui>Save and voice</Ui>, <Ui>Move to playhead</Ui>, or <Ui>Delete</Ui>.
              </li>
              <li>
                Drag a line along the lane to move it. Dropped in another step, it belongs to that step.
              </li>
              <li>Lines shown in red play over another line. Move one, or run Fit timing.</li>
            </ul>
            <h3>Fit timing and Regenerate VO</h3>
            <ul>
              <li>
                <Ui>Fit timing</Ui> freezes the picture where a line is longer than its step, and
                fast-forwards what runs on after the last line.
              </li>
              <li>
                <Ui>Regenerate VO</Ui> voices the step narration again (unchanged lines come from the cache)
                and fits the timing.
              </li>
              <li>Both keep the lines and pieces you edited by hand.</li>
            </ul>
            <Shot
              src={lineShot}
              alt="A voice line selected on the Voice-over lane, with the Voice line panel showing its step, length and text"
              caption="A selected voice line. Dashed lines on the lane were written by hand."
            />
          </Section>

          <Section id="overlays">
            <p>
              The cursor, click ripples, zooms, captions, the title and blurs are added for you from the
              recording (<Ui>Auto overlays</Ui> rebuilds them). Add your own from the Library or the tool
              rail.
            </p>
            <div className="guide-table">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Tool on the preview</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['V', 'Select and move overlays'],
                    ['P', 'Pin a note for the agent at a point'],
                    ['R', 'Mark a region with a note'],
                    ['T', 'Add a text label'],
                    ['Z', 'Zoom on an area'],
                    ['B', 'Blur an area (secrets, emails, machine paths)'],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <Kbd>{k}</Kbd>
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul>
              <li>Hover a tool to see its name and key. The ‹ button hides the rail; the keys still work.</li>
              <li>Drag a Library tile onto the Overlays lane, then set its properties in the Inspector.</li>
              <li>
                A note (pin or region) asks the agent for a change at that moment: write it, then{' '}
                <Ui>Send to agent</Ui>. Switch the view to <Ui>With annotations</Ui> to see notes in the
                preview.
              </li>
            </ul>
            <Shot
              src={toolsShot}
              alt="The tool rail on the preview with the Pin annotation tooltip showing its key P"
              caption="The tool rail. Hovering a tool shows its name and shortcut."
            />
          </Section>

          <Section id="explainers">
            <p>
              An explainer is an animated scene between recorded steps, for a concept the screen can't show
              (for example how a chat agent calls its tools).
            </p>
            <ul>
              <li>
                <b>From the Library.</b> Pick a scene in the timeline toolbar and click{' '}
                <Ui>+ Insert explainer</Ui> (or press <Kbd>X</Kbd>). It goes in at the playhead.
              </li>
              <li>
                <b>Ask the agent.</b> Click <Ui>Ask the agent…</Ui>, describe what it should show, and click{' '}
                <Ui>Storyboard it</Ui>. Approve the storyboard in the <Ui>Explainer review</Ui> tab before it
                is built.
              </li>
              <li>Click an explainer on the Scenes lane to edit its narration and properties.</li>
            </ul>
          </Section>

          <Section id="agent">
            <p>
              Ask for edits in the <Ui>Agent</Ui> tab in plain words. It edits the same timeline you do, with
              the same tools, and keeps your hand edits.
            </p>
            <ul className="guide-examples" aria-label="Example requests">
              <li>Speed up 2:30 to 3:30 to 4×.</li>
              <li>Add a line at 1:45 saying the other tools are added the same way.</li>
              <li>Cut the wait after Run and freeze the result for 2 seconds.</li>
              <li>Run find_silences and handle each silent stretch.</li>
              <li>Add a title at the start, and no zooms during the 4× stretches.</li>
            </ul>
            <p>
              After a run, a banner says what changed. <Ui>Review changes</Ui> opens the run:{' '}
              <Ui>Accept changes</Ui>, <Ui>Send follow-up</Ui> to refine it, or <Ui>Revert run</Ui> to undo
              all of it at once.
            </p>
            <p className="guide-tip">
              <b>Silent stretches are handled for you.</b> After the voice-over, post-production lists every
              stretch with no voice. The agent narrates what the viewer should follow, speeds up repeats and
              routine work, and cuts idle waits.
            </p>
            <Shot
              src={agentShot}
              alt="The Agent tab in the Studio's left panel showing the conversation with the agent"
              caption="The Agent tab keeps the whole conversation for the project."
            />
          </Section>

          <Section id="export">
            <p>
              Click <Ui>Export</Ui> at the top right. Choose the resolution (720p, 1080p or 4K) and frame rate
              (24, 30 or 60), then <Ui>Start export</Ui>.
            </p>
            <ul>
              <li>
                <b>Video</b>: an MP4 with overlays burned in.
              </li>
              <li>
                <b>Captions</b>: SRT and VTT files.
              </li>
              <li>
                <b>Step-by-step doc</b>: a Markdown write-up with images.
              </li>
              <li>
                <b>Playwright script</b>: to record the tutorial again later.
              </li>
            </ul>
            <Shot
              src={exportShot}
              alt="The Export screen with resolution, frame rate and the list of outputs"
              caption="Export settings and outputs."
            />
          </Section>

          <Section id="keys">
            <p>In the Studio, when you aren't typing in a field.</p>
            <div className="guide-table">
              <table>
                <thead>
                  <tr>
                    <th>Keys</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      [['Space'], 'Play or pause'],
                      [['J', 'L'], 'Back or forward 1 second (K pauses)'],
                      [['←', '→'], 'Back or forward one frame'],
                      [['S'], 'Split the recording at the playhead'],
                      [['X'], 'Insert the chosen explainer at the playhead'],
                      [['V', 'P', 'R', 'T', 'Z', 'B'], 'Preview tools (see Overlays and notes)'],
                      [['Delete'], 'Remove the selected overlay or recording piece'],
                      [['⌘ Z', '⇧ ⌘ Z'], 'Undo / redo'],
                      [['F'], 'Full screen preview'],
                      [['Esc'], 'Leave full screen, or deselect'],
                    ] as const
                  ).map(([keys, action]) => (
                    <tr key={action}>
                      <td>
                        {keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </td>
                      <td>{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              On the seek bar under the preview: click or drag to seek, <Kbd>←</Kbd> <Kbd>→</Kbd> move 1
              second (<Kbd>⇧</Kbd> 5 seconds).
            </p>
          </Section>
        </main>
      </div>
    </AppFrame>
  );
}
