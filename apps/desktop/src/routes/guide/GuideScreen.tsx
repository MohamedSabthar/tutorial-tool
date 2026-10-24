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
  ['how', '13', "How it's built"],
  ['keys', '⌨', 'Keyboard shortcuts'],
] as const;
type SectionId = (typeof GUIDE_SECTIONS)[number][0];

/** A link to one section of the guide, for help next to the controls it explains. */
export const guideHref = (section: SectionId) => `#/guide?s=${section}`;

const show = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start' });

function Section({ id, eyebrow, children }: { id: SectionId; eyebrow?: string; children: ReactNode }) {
  const [, n, title] = GUIDE_SECTIONS.find(([s]) => s === id)!;
  return (
    <section id={`guide-${id}`} className="guide-section" aria-labelledby={`guide-${id}-h`}>
      {eyebrow && <span className="guide-eyebrow">{eyebrow}</span>}
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

          <Section id="how" eyebrow="For the curious">
            <p>
              You don't need this to make tutorials. It's for anyone who wants to know what happens
              underneath: three parts, one agent loop, and a pipeline with loops at every stage where
              something can go wrong.
            </p>
            <p>
              The parts: the desktop app you click in; an engine running next to it that holds the pipeline,
              the agent session and the tools; and a workspace folder (its own git repository) where every
              tutorial and everything the agent has learned is kept.
            </p>
            <h3>The parts</h3>
            <div
              className="guide-arch"
              role="img"
              aria-label="The desktop app talks to the engine over a local WebSocket. The engine drives the Claude agent, ElevenLabs, the WSO2 product, headless Chromium and ffmpeg, and reads and writes the workspace folder."
            >
              <div className="guide-arch-row">
                <div className="guide-arch-box">
                  <h4>
                    Desktop app <small>Tauri · React</small>
                  </h4>
                  <ul>
                    <li>
                      <b>Screens</b>: Projects, Brief, Storyboard, Live, Studio, Export, Settings, Guide
                    </li>
                    <li>
                      <b>Preview stage</b>: the video, overlays and explainers drawn as a function of time
                    </li>
                    <li>
                      <b>Timeline</b>: every edit sent as a checked change
                    </li>
                  </ul>
                </div>
                <div className="guide-arch-box" data-part="engine">
                  <h4>
                    Engine <small>Node, runs beside the app</small>
                  </h4>
                  <ul>
                    <li>
                      <b>Pipeline</b>: runs the stages, waits at your gates
                    </li>
                    <li>
                      <b>Agent session</b>: one per project, with the studio tools
                    </li>
                    <li>
                      <b>Recorder</b>: drives the product with Playwright, logs every action
                    </li>
                    <li>
                      <b>Voice-over and timing fit</b>
                    </li>
                    <li>
                      <b>Timeline store</b>: validates changes, undo and redo
                    </li>
                    <li>
                      <b>Exporter</b>: renders frames, encodes the MP4
                    </li>
                  </ul>
                </div>
                <div className="guide-arch-box" data-part="ext">
                  <h4>
                    Outside services <small>called by the engine</small>
                  </h4>
                  <ul>
                    <li>
                      <b>Claude</b>: the agent (Claude Code, through the Agent SDK)
                    </li>
                    <li>
                      <b>ElevenLabs</b>: voices the narration, with word timings
                    </li>
                    <li>
                      <b>WSO2 product</b>: WSO2 Integrator or VS Code with its extension
                    </li>
                    <li>
                      <b>Headless Chromium</b>: renders the video for export
                    </li>
                    <li>
                      <b>ffmpeg</b>: encodes and mixes the audio
                    </li>
                  </ul>
                </div>
              </div>
              <div className="guide-arch-links" aria-hidden="true">
                <span>WebSocket + live events</span>
                <span>reads and writes files</span>
                <span>APIs, browser automation</span>
              </div>
              <div className="guide-arch-ws">
                <h4>Workspace folder (its own git repository)</h4>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Skills and lessons the agent keeps up to date (<code>.claude/skills/</code>,{' '}
                  <code>CLAUDE.md</code>), shared overlays and explainer scenes, and one folder per tutorial:{' '}
                  <code>tutorial.json</code> (the timeline), <code>script.spec.ts</code>,{' '}
                  <code>recordings/</code>, <code>audio/</code>, <code>output/</code>.
                </p>
              </div>
            </div>

            <h3>The agent loop</h3>
            <figure className="guide-diagram">
              <svg
                viewBox="0 0 1000 540"
                role="img"
                aria-label="The pipeline hands the agent a stage. The agent loops, calling studio tools in the engine and reading their results, until it reports the stage done. Only the tools touch the product, the timeline, ElevenLabs, the skills and the export browser; the app sees every change live. You steer at the gates, in chat and notes, and in Review changes."
              >
                <defs>
                  <marker
                    id="ah"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                  </marker>
                  <marker
                    id="aho"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,5 L0,10 z" className="d-orange-fill" />
                  </marker>
                </defs>
                {/* You */}
                <rect x="20" y="30" width="180" height="150" rx="12" className="d-gate" />
                <text x="110" y="62" textAnchor="middle" className="d-title">
                  You
                </text>
                <text x="110" y="92" textAnchor="middle" className="d-small">
                  brief · gates
                </text>
                <text x="110" y="114" textAnchor="middle" className="d-small">
                  chat · notes on frames
                </text>
                <text x="110" y="136" textAnchor="middle" className="d-small">
                  Review changes
                </text>
                <text x="110" y="158" textAnchor="middle" className="d-small">
                  hand edits
                </text>
                {/* Pipeline */}
                <rect x="20" y="270" width="180" height="120" rx="12" className="d-box" />
                <text x="110" y="302" textAnchor="middle" className="d-title">
                  Pipeline
                </text>
                <text x="110" y="330" textAnchor="middle" className="d-small">
                  stages in order
                </text>
                <text x="110" y="352" textAnchor="middle" className="d-small">
                  waits at your gates
                </text>
                <line x1="110" y1="180" x2="110" y2="268" className="d-line" markerEnd="url(#ah)" />
                <text x="118" y="230" className="d-label">
                  approve · revise
                </text>
                {/* Agent */}
                <rect x="270" y="150" width="240" height="230" rx="16" className="d-agent" />
                <text x="390" y="182" textAnchor="middle" className="d-title">
                  Agent session
                </text>
                <text x="390" y="202" textAnchor="middle" className="d-small">
                  Claude Code · one per project
                </text>
                <path d="M 438 270 A 52 52 0 1 0 438 310" className="d-loop" markerEnd="url(#aho)" />
                <text x="390" y="282" textAnchor="middle" className="d-small">
                  think
                </text>
                <text x="390" y="300" textAnchor="middle" className="d-small">
                  call a tool
                </text>
                <text x="390" y="318" textAnchor="middle" className="d-small">
                  read result
                </text>
                <text x="390" y="368" textAnchor="middle" className="d-label">
                  until the stage is done
                </text>
                {/* Pipeline <-> Agent */}
                <line x1="200" y1="300" x2="268" y2="300" className="d-line" markerEnd="url(#ah)" />
                <text x="234" y="292" textAnchor="middle" className="d-label">
                  stage
                </text>
                <line x1="268" y1="340" x2="200" y2="340" className="d-line" markerEnd="url(#ah)" />
                <text x="234" y="358" textAnchor="middle" className="d-label">
                  stage_done
                </text>
                {/* You -> Agent */}
                <path
                  d="M 200 110 C 250 110, 300 120, 320 148"
                  className="d-line d-dash"
                  markerEnd="url(#ah)"
                />
                <text x="232" y="102" className="d-label">
                  chat · notes
                </text>
                {/* Tools */}
                <rect x="580" y="30" width="210" height="440" rx="12" className="d-engine" />
                <text x="685" y="60" textAnchor="middle" className="d-title">
                  Studio tools
                </text>
                <text x="685" y="80" textAnchor="middle" className="d-small">
                  in the engine
                </text>
                <g className="d-group">
                  <rect x="596" y="96" width="178" height="64" rx="8" />
                  <text x="608" y="116" className="d-gname">
                    Read
                  </text>
                  <text x="608" y="134" className="d-tool">
                    get_timeline · get_events
                  </text>
                  <text x="608" y="150" className="d-tool">
                    capture_frame
                  </text>
                  <rect x="596" y="168" width="178" height="54" rx="8" />
                  <text x="608" y="188" className="d-gname">
                    Run
                  </text>
                  <text x="608" y="206" className="d-tool">
                    run_script · inspect_ui
                  </text>
                  <rect x="596" y="230" width="178" height="80" rx="8" />
                  <text x="608" y="250" className="d-gname">
                    Edit
                  </text>
                  <text x="608" y="268" className="d-tool">
                    apply_timeline_patch
                  </text>
                  <text x="608" y="284" className="d-tool">
                    edit_recording · freeze_frame
                  </text>
                  <text x="608" y="300" className="d-tool">
                    add_voice_line
                  </text>
                  <rect x="596" y="318" width="178" height="64" rx="8" />
                  <text x="608" y="338" className="d-gname">
                    Voice and timing
                  </text>
                  <text x="608" y="356" className="d-tool">
                    generate_voiceover
                  </text>
                  <text x="608" y="372" className="d-tool">
                    fit_timing · find_silences
                  </text>
                  <rect x="596" y="390" width="178" height="64" rx="8" />
                  <text x="608" y="410" className="d-gname">
                    Check
                  </text>
                  <text x="608" y="428" className="d-tool">
                    check_overlay · check_scene
                  </text>
                  <text x="608" y="444" className="d-tool">
                    check_video
                  </text>
                </g>
                {/* Agent <-> Tools */}
                <line x1="510" y1="250" x2="578" y2="250" className="d-line" markerEnd="url(#ah)" />
                <text x="544" y="242" textAnchor="middle" className="d-label">
                  tool call
                </text>
                <line x1="578" y1="290" x2="510" y2="290" className="d-line" markerEnd="url(#ah)" />
                <text x="544" y="310" textAnchor="middle" className="d-label">
                  result
                </text>
                <text x="544" y="324" textAnchor="middle" className="d-label">
                  + frames
                </text>
                {/* Resources */}
                <g className="d-res">
                  <rect x="840" y="40" width="145" height="58" rx="10" />
                  <text x="912" y="64" textAnchor="middle" className="d-name">
                    WSO2 product
                  </text>
                  <text x="912" y="82" textAnchor="middle" className="d-small">
                    Playwright
                  </text>
                  <rect x="840" y="122" width="145" height="58" rx="10" />
                  <text x="912" y="146" textAnchor="middle" className="d-name">
                    tutorial.json
                  </text>
                  <text x="912" y="164" textAnchor="middle" className="d-small">
                    the timeline
                  </text>
                  <rect x="840" y="204" width="145" height="58" rx="10" />
                  <text x="912" y="228" textAnchor="middle" className="d-name">
                    ElevenLabs
                  </text>
                  <text x="912" y="246" textAnchor="middle" className="d-small">
                    voice + word times
                  </text>
                  <rect x="840" y="286" width="145" height="58" rx="10" />
                  <text x="912" y="310" textAnchor="middle" className="d-name">
                    Skills
                  </text>
                  <text x="912" y="328" textAnchor="middle" className="d-small">
                    workspace git
                  </text>
                  <rect x="840" y="368" width="145" height="58" rx="10" />
                  <text x="912" y="392" textAnchor="middle" className="d-name">
                    Stage renderer
                  </text>
                  <text x="912" y="410" textAnchor="middle" className="d-small">
                    headless Chromium
                  </text>
                </g>
                <line x1="790" y1="69" x2="838" y2="69" className="d-line" markerEnd="url(#ah)" />
                <text x="814" y="62" textAnchor="middle" className="d-label">
                  drives
                </text>
                <line x1="790" y1="151" x2="838" y2="151" className="d-line" markerEnd="url(#ah)" />
                <text x="814" y="144" textAnchor="middle" className="d-label">
                  patch
                </text>
                <line x1="790" y1="233" x2="838" y2="233" className="d-line" markerEnd="url(#ah)" />
                <text x="814" y="226" textAnchor="middle" className="d-label">
                  voice
                </text>
                <line
                  x1="790"
                  y1="315"
                  x2="838"
                  y2="315"
                  className="d-line"
                  markerEnd="url(#ah)"
                  markerStart="url(#ah)"
                />
                <text x="814" y="308" textAnchor="middle" className="d-label">
                  learn
                </text>
                <line x1="790" y1="397" x2="838" y2="397" className="d-line" markerEnd="url(#ah)" />
                <text x="814" y="390" textAnchor="middle" className="d-label">
                  render
                </text>
                {/* App */}
                <rect x="270" y="430" width="240" height="80" rx="12" className="d-box" />
                <text x="390" y="462" textAnchor="middle" className="d-title">
                  Desktop app
                </text>
                <text x="390" y="484" textAnchor="middle" className="d-small">
                  Studio · Live · Storyboard
                </text>
                <path d="M 912 426 L 912 500 L 512 500" className="d-line" markerEnd="url(#ah)" />
                <text x="700" y="492" textAnchor="middle" className="d-label">
                  every change, live (WebSocket)
                </text>
                <path d="M 270 470 L 150 470 L 150 182" className="d-line d-dash" markerEnd="url(#ah)" />
                <text x="158" y="420" className="d-label">
                  you edit and review
                </text>
              </svg>
              <figcaption>
                The agent loop. A stage goes in; the agent thinks, calls a studio tool, reads the result, and
                repeats until it reports the stage done. The tools are its only way to touch the product, the
                timeline, the voice, the skills and the renderer, and the app shows every change as it
                happens.
              </figcaption>
            </figure>

            <h3>From brief to video</h3>
            <div className="guide-diagram-scroll">
              <figure className="guide-diagram">
                <svg
                  viewBox="0 0 1120 440"
                  role="img"
                  aria-label="The pipeline runs left to right from Plan to Retro. Loops: you can send the plan and the narration back for revision; a failed dry run goes to repair and back; post-production narrates, speeds up or cuts silent stretches and fits the timing, up to two rounds; QA checks the video and fixes it; the retrospective's lessons feed the next tutorial's plan."
                >
                  <defs>
                    <marker
                      id="bh"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                    </marker>
                    <marker
                      id="bho"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" className="d-orange-fill" />
                    </marker>
                  </defs>
                  {/* nodes: centres x = 60 + 100 i, y = 170 */}
                  <g className="d-nodes">
                    <rect x="18" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="60" y="175" textAnchor="middle" className="d-name">
                      Plan
                    </text>
                    <rect x="118" y="148" width="84" height="44" rx="10" className="d-gate" />
                    <text x="160" y="167" textAnchor="middle" className="d-name">
                      Plan
                    </text>
                    <text x="160" y="183" textAnchor="middle" className="d-name">
                      review
                    </text>
                    <rect x="218" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="260" y="175" textAnchor="middle" className="d-name">
                      Script
                    </text>
                    <rect x="318" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="360" y="175" textAnchor="middle" className="d-name">
                      Dry run
                    </text>
                    <rect x="418" y="148" width="84" height="44" rx="10" className="d-gate" />
                    <text x="460" y="167" textAnchor="middle" className="d-name">
                      Narration
                    </text>
                    <text x="460" y="183" textAnchor="middle" className="d-name">
                      review
                    </text>
                    <rect x="518" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="560" y="167" textAnchor="middle" className="d-name">
                      Voice +
                    </text>
                    <text x="560" y="183" textAnchor="middle" className="d-name">
                      align
                    </text>
                    <rect x="618" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="660" y="175" textAnchor="middle" className="d-name">
                      Record
                    </text>
                    <rect x="718" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="760" y="167" textAnchor="middle" className="d-name">
                      Post-
                    </text>
                    <text x="760" y="183" textAnchor="middle" className="d-name">
                      production
                    </text>
                    <rect x="818" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="860" y="175" textAnchor="middle" className="d-name">
                      QA
                    </text>
                    <rect x="918" y="148" width="84" height="44" rx="10" className="d-box" />
                    <text x="960" y="175" textAnchor="middle" className="d-name">
                      Retro
                    </text>
                    <rect x="1018" y="148" width="84" height="44" rx="10" className="d-agent" />
                    <text x="1060" y="167" textAnchor="middle" className="d-name">
                      Video in
                    </text>
                    <text x="1060" y="183" textAnchor="middle" className="d-name">
                      the Studio
                    </text>
                  </g>
                  <g className="d-line" markerEnd="url(#bh)">
                    <line x1="102" y1="170" x2="116" y2="170" />
                    <line x1="202" y1="170" x2="216" y2="170" />
                    <line x1="302" y1="170" x2="316" y2="170" />
                    <line x1="402" y1="170" x2="416" y2="170" />
                    <line x1="502" y1="170" x2="516" y2="170" />
                    <line x1="602" y1="170" x2="616" y2="170" />
                    <line x1="702" y1="170" x2="716" y2="170" />
                    <line x1="802" y1="170" x2="816" y2="170" />
                    <line x1="902" y1="170" x2="916" y2="170" />
                    <line x1="1002" y1="170" x2="1016" y2="170" />
                  </g>
                  {/* revise loops (you) */}
                  <path
                    d="M 150 148 C 140 100, 80 100, 70 146"
                    className="d-line d-steel"
                    markerEnd="url(#bh)"
                  />
                  <text x="110" y="96" textAnchor="middle" className="d-label">
                    revise
                  </text>
                  <path
                    d="M 472 148 C 492 98, 428 98, 448 146"
                    className="d-line d-steel"
                    markerEnd="url(#bh)"
                  />
                  <text x="460" y="92" textAnchor="middle" className="d-label">
                    revise
                  </text>
                  {/* repair loop */}
                  <rect x="318" y="246" width="84" height="40" rx="10" className="d-box" />
                  <text x="360" y="271" textAnchor="middle" className="d-name">
                    Repair
                  </text>
                  <path d="M 344 192 L 344 244" className="d-line" markerEnd="url(#bh)" />
                  <text x="338" y="222" textAnchor="end" className="d-label">
                    fails
                  </text>
                  <path d="M 376 244 L 376 194" className="d-line" markerEnd="url(#bh)" />
                  <text x="382" y="214" className="d-label">
                    fixed script
                  </text>
                  <text x="382" y="228" className="d-label">
                    + skill note
                  </text>
                  <text x="360" y="306" textAnchor="middle" className="d-label">
                    after N tries: asks you
                  </text>
                  {/* polish loop */}
                  <path d="M 744 192 C 724 262, 796 262, 776 194" className="d-loop" markerEnd="url(#bho)" />
                  <text x="760" y="276" textAnchor="middle" className="d-label">
                    silent stretches:
                  </text>
                  <text x="760" y="290" textAnchor="middle" className="d-label">
                    narrate · speed · cut
                  </text>
                  <text x="760" y="304" textAnchor="middle" className="d-label">
                    then fit, ≤ 2 rounds
                  </text>
                  {/* QA loop */}
                  <path d="M 872 148 C 892 98, 828 98, 848 146" className="d-loop" markerEnd="url(#bho)" />
                  <text x="860" y="92" textAnchor="middle" className="d-label">
                    check_video → fix
                  </text>
                  {/* learning loop */}
                  <path d="M 960 192 C 960 470, 60 470, 60 194" className="d-learn" markerEnd="url(#bho)" />
                  <text x="560" y="428" textAnchor="middle" className="d-label d-orange-text">
                    lessons committed to the skills: the next tutorial plans from them
                  </text>
                  {/* legend */}
                  <rect x="18" y="20" width="14" height="14" rx="3" className="d-gate" />
                  <text x="38" y="32" className="d-label">
                    your gate
                  </text>
                  <path d="M 118 27 L 148 27" className="d-loop" />
                  <text x="154" y="32" className="d-label">
                    agent loop
                  </text>
                </svg>
                <figcaption>
                  The pipeline and its loops. Steel loops are yours: send the plan or the narration back.
                  Orange loops are the agent's: repair a failing script, polish silent stretches, fix what QA
                  finds. The long arc is how it learns: the retrospective's lessons shape the next plan.
                </figcaption>
              </figure>
            </div>
            <div className="guide-table">
              <table className="guide-stages">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Who</th>
                    <th>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Research and plan</td>
                    <td>Agent</td>
                    <td>
                      Reads the brief and the product skill, looks at the live product where the skill has
                      gaps, and splits the task into steps with proposed explainers.
                    </td>
                  </tr>
                  <tr>
                    <td>Plan review</td>
                    <td>You</td>
                    <td>Approve the steps, edit them, or ask for changes.</td>
                  </tr>
                  <tr>
                    <td>Write the script</td>
                    <td>Agent</td>
                    <td>
                      Writes <code>script.spec.ts</code> with the recorder's helpers and the skill's page
                      objects.
                    </td>
                  </tr>
                  <tr>
                    <td>Dry run and repair</td>
                    <td>Engine, agent</td>
                    <td>
                      Runs the script in the real product. On a failure the agent finds the cause, fixes the
                      script, records what it learned in the skill, and runs it again; after the repair limit
                      it asks you.
                    </td>
                  </tr>
                  <tr>
                    <td>Narration review</td>
                    <td>Agent, you</td>
                    <td>
                      The agent writes each step's narration from what the dry run showed, sized to its time
                      on camera; you review it.
                    </td>
                  </tr>
                  <tr>
                    <td>Voice-over and align</td>
                    <td>Engine, agent</td>
                    <td>
                      ElevenLabs voices each line. Actions in the script are cued to words in the narration.
                    </td>
                  </tr>
                  <tr>
                    <td>Record the take</td>
                    <td>Engine</td>
                    <td>
                      Runs the script again, paced to the voice, so each cued click lands on its word. The
                      screen streams to Live, and every click, keystroke and target box goes into{' '}
                      <code>events.jsonl</code>.
                    </td>
                  </tr>
                  <tr>
                    <td>Post-production</td>
                    <td>Engine, agent</td>
                    <td>
                      Puts the voice-over on the timeline, fits the timing, builds the cursor, zooms, captions
                      and badges from the events, builds the explainers, and handles silent stretches.
                    </td>
                  </tr>
                  <tr>
                    <td>Final QA</td>
                    <td>Agent</td>
                    <td>
                      Renders contact sheets of the video and fixes what it can: overlays over the action,
                      captions in the way, secrets on screen.
                    </td>
                  </tr>
                  <tr>
                    <td>Retrospective</td>
                    <td>Agent</td>
                    <td>Writes lessons into the skills and commits them to the workspace.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>The timeline</h3>
            <p>
              <code>tutorial.json</code> is the single source of truth for a tutorial. It holds the scenes
              (recording pieces that play part of a take at some speed or freeze a frame, and explainer
              scenes), the steps, voice lines, captions, overlays and notes. Every change, yours or the
              agent's, is a checked patch: that gives undo and redo, keeps every open window in sync, and lets
              a whole agent run be reviewed and reverted at once. Pieces and lines you edit by hand are
              marked, so automatic steps such as the timing fit leave them alone.
            </p>

            <h3>Preview and export</h3>
            <p>
              The preview is a stage that draws the frame for any moment in time: the recording on a plane in
              a 3D scene, with overlays and explainers on top. Overlays are React components that depend only
              on time, with no clocks, timers or CSS animations, so the same moment always looks the same.
              Export opens the same stage in headless Chromium, steps through every frame in parallel workers,
              encodes them with the Mac's hardware encoder through ffmpeg, and mixes in the voice-over. That
              is why the preview and the exported video match, and why the app's theme never changes the
              video.
            </p>

            <h3>The agent</h3>
            <p>
              Each project has one long-running Claude Code session, resumed across restarts, working in the
              project's folder. It changes the tutorial only through the studio tools: reading the timeline
              and frames, running and inspecting the script, editing the timeline, voicing lines, editing the
              recording, checking overlays, scenes and the final video. With auto mode on, safe calls run
              without asking; anything else waits for you to allow it. Each run's changes are grouped, so
              Review changes can accept or revert them together.
            </p>

            <h3>It learns as it goes</h3>
            <p>
              Product knowledge lives in the workspace as skills: a note per component with its flows and
              pitfalls, and page objects the scripts reuse. The agent only researches the live product again
              when a script fails after a UI change, then updates the skill. Good overlays and explainer
              scenes are promoted to the shared library. After every tutorial the retrospective commits what
              was learned, so the next tutorial starts further ahead.
            </p>

            <h3>Built with</h3>
            <ul className="guide-stack">
              <li>
                <b>Desktop app</b>Tauri v2 (a Rust shell) with a React 19 and Vite UI.{' '}
                <code>apps/desktop</code>
              </li>
              <li>
                <b>Engine</b>A Node sidecar the app starts: RPC over a local WebSocket, the pipeline, agent
                sessions, recording, voice-over and export. <code>apps/engine</code>
              </li>
              <li>
                <b>Agent</b>The Claude Agent SDK (headless Claude Code), with the studio tools as an
                in-process MCP server.
              </li>
              <li>
                <b>Recorder</b>Playwright drives WSO2 Integrator or VS Code with the extension; CDP screencast
                feeds Live. <code>packages/recorder</code>
              </li>
              <li>
                <b>Timeline</b>zod schemas and validated JSON patches, plus the time map from output time to
                the take. <code>packages/core</code>
              </li>
              <li>
                <b>Stage</b>React Three Fiber and three.js for the video plane and camera, GSAP for motion, a
                virtual clock for frame-exact export. <code>packages/stage</code>, <code>overlay-sdk</code>,{' '}
                <code>overlays-core</code>, <code>scenes-core</code>
              </li>
              <li>
                <b>Voice</b>ElevenLabs with word timings, for the voice-over, captions and cues.{' '}
                <code>packages/tts</code>
              </li>
              <li>
                <b>Export</b>Headless Chromium renders frames in parallel; ffmpeg encodes with the hardware
                encoder and mixes the audio. <code>packages/exporters</code>
              </li>
              <li>
                <b>Look and feel</b>The WSO2 Slides design system as shared tokens and components, light and
                dark. <code>packages/ui</code>
              </li>
            </ul>

            <div className="guide-tip">
              <b>Keys and code stay contained.</b> The ElevenLabs key is kept in the macOS Keychain and never
              reaches the agent. The app and the engine talk over a local connection protected by a token.
              Overlay and scene code the agent writes runs only inside the preview stage or the export
              browser, without access to your files.
            </div>
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
