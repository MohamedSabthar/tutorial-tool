import type { ExplainerScene, VoiceLine } from '@studio/core';
import { looksFor } from '@studio/scenes-core';
import { Button, Glyph, IconButton, Shell, ShellHeader, ShellPanel, StatusPill } from '@studio/ui';
import { mmss } from './model';

/** "BlueprintFlow" → "Blueprint flow". */
export const plainName = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/ (\w)/g, (_, c: string) => ` ${c.toLowerCase()}`);

/**
 * An explainer picked on the Steps track: its look (and the looks it can switch to), how long it
 * plays, what's said over it, and Remove.
 */
export function ExplainerPanel({
  scene,
  name,
  start,
  end,
  voice,
  onLook,
  onRemove,
  onClose,
}: {
  scene: ExplainerScene;
  /** The look's name. */
  name: string;
  start: number;
  end: number;
  voice: VoiceLine[];
  onLook: (component: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const looks = looksFor(scene.component);
  const len = Math.round((end - start) * 10) / 10;
  const script = voice.length ? voice.map((v) => v.text) : scene.narration;
  const voiced = voice.length > 0 && voice.every((v) => !!v.audio);
  return (
    <Shell className="ed-side" aria-label="Explainer">
      <ShellHeader
        icon="film"
        tone="brand"
        title="Explainer"
        subtitle={
          <span className="ed-tab">
            {mmss(start)}–{mmss(end)} · {len} s
          </span>
        }
        aside={
          <IconButton variant="quiet" label="Close and go back to the step" onClick={onClose}>
            <Glyph name="x" size={14} />
          </IconButton>
        }
      />
      <ShellPanel className="ed-sp">
        <div className="ed-sec">
          <div className="ed-sec-h">
            <Glyph name="film" size={12} />
            <span id="ed-ex-look">Look</span>
          </div>
          <p className="ed-s13 ed-pc-d">{plainName(name)}</p>
          {looks.length > 1 && (
            <div role="group" aria-labelledby="ed-ex-look" className="ui-seg ui-seg-block">
              {looks.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="ui-seg-item"
                  aria-pressed={l.id === scene.component}
                  onClick={() => l.id !== scene.component && onLook(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ed-sec">
          <div className="ed-sec-h">
            <Glyph name="clock" size={12} />
            <span>Length</span>
          </div>
          <p className="ed-s13 ed-pc-d">
            {len} s{' '}
            <span className="ed-muted">
              {scene.duration === 'auto' ? '· follows its voice-over' : '· a fixed length'}
            </span>
          </p>
        </div>

        <div className="ed-sec">
          <div className="ed-sec-h">
            <Glyph name="mic" size={12} />
            <span>What's said</span>
            <span className="ed-grow" />
            {script.length > 0 &&
              (voiced ? (
                <StatusPill tone="positive" icon="check">
                  Voiced
                </StatusPill>
              ) : (
                <StatusPill tone="warning">Not voiced yet</StatusPill>
              ))}
          </div>
          {script.length ? (
            script.map((line, i) => (
              <p key={i} className="ed-s13 ed-ex-line">
                {line}
              </p>
            ))
          ) : (
            <p className="ed-muted ed-s13">No script yet. Ask the agent to write one for this explainer.</p>
          )}
        </div>

        <div className="ed-sec">
          <div className="ed-row">
            <Button size="sm" variant="danger" onClick={onRemove}>
              <Glyph name="trash" size={12} />
              Remove explainer
            </Button>
          </div>
        </div>
      </ShellPanel>
    </Shell>
  );
}
