import { useState } from 'react';
import type { LateCueFix, OverlayInstance, Step, Timeline, VoiceLine } from '@studio/core';
import { Button, Glyph, IconTile, StatusPill, type GlyphName } from '@studio/ui';
import type { StepSpan } from '../resolve';
import {
  LABEL_TONES,
  mmss,
  overlayIcon,
  overlayName,
  overlayText,
  overlaysIn,
  textProp,
  VIDEO_COLORS,
  type Pace,
} from './model';

export type AddKind = 'arrow' | 'label' | 'box' | 'blur';

export interface StepPanelProps {
  timeline: Timeline;
  step: Step;
  span: StepSpan;
  index: number;
  pace: Pace;
  /** Unsaved script edits, by voice line id (or `step:<id>` for a step without a line yet). */
  drafts: Record<string, string>;
  onDraft: (key: string, text: string | null) => void;
  /** Lines being voiced now. */
  voicing: Set<string>;
  onRevoice: (line: VoiceLine, text: string) => void;
  onVoiceStep: (text: string) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  names: Record<string, string | undefined>;
  onAdd: (kind: AddKind) => void;
  onEditOverlay: (o: OverlayInstance, change: { props?: Record<string, unknown>; end?: number }, label: string) => void;
  onRemoveOverlay: (o: OverlayInstance) => void;
  onPace: (pace: Pace['kind']) => void;
  paceBusy: boolean;
  lateCues: LateCueFix[];
  onFixCues: (() => void) | null;
}

const PACE_TEXT: Record<Pace['kind'], string> = {
  normal: 'Plays in time with the voice-over.',
  fast: 'Plays at 2×. Good for repetitive steps.',
  skip: 'Left out of the video. Its voice-over goes with it.',
};

/** Everything about the step at the playhead: what's said, what's on screen, and its pace. */
export function StepPanel(p: StepPanelProps) {
  const lines = p.timeline.voice.filter((v) => v.owner === p.step.id).sort((a, b) => a.start - b.start);
  const overlays = overlaysIn(p.timeline, p.span).sort((a, b) => a.start - b.start);
  const sel = overlays.find((o) => o.id === p.selected) ?? null;
  const changed = lines.some((l) => p.drafts[l.id] !== undefined && p.drafts[l.id] !== l.text);
  const busy = lines.some((l) => p.voicing.has(l.id)) || p.voicing.has(`step:${p.step.id}`);
  const voiced = lines.length > 0 && lines.every((l) => !!l.audio);
  return (
    <section className="k-shell ed-side" aria-label="This step">
      <div className="k-shead">
        <span className="ed-num" aria-hidden="true">
          {p.index + 1}
        </span>
        <div className="k-shead-text">
          <h2 className="ed-wrap">{p.step.title}</h2>
          <p className="ed-tab">
            {p.pace.kind === 'skip'
              ? 'Skipped'
              : `${mmss(p.span.start)}–${mmss(p.span.end)} · ${Math.round(p.span.end - p.span.start)} s`}
          </p>
        </div>
      </div>
      <div className="k-panel ed-sp">
        {p.lateCues.length > 0 && (
          <div className="ed-warnbox" role="note">
            <Glyph name="warn" size={14} />
            <span>
              {p.lateCues.length === 1
                ? `“${p.lateCues[0]!.word}” happens ${p.lateCues[0]!.late.toFixed(1)} s after it's said.`
                : `${p.lateCues.length} actions happen after they're said.`}
            </span>
            {p.onFixCues && (
              <Button size="sm" variant="silver" onClick={p.onFixCues}>
                Fix it
              </Button>
            )}
          </div>
        )}

        <div className="ed-sec">
          <div className="ed-sec-h">
            <Glyph name="mic" size={12} />
            <span id="ed-said-h">What's said</span>
            <span className="ed-grow" />
            {busy ? (
              <StatusPill tone="brand" busy>
                Voicing
              </StatusPill>
            ) : changed || !voiced ? (
              <StatusPill tone="warning">Not voiced yet</StatusPill>
            ) : (
              <StatusPill tone="positive" icon="check">
                Voiced
              </StatusPill>
            )}
          </div>
          {lines.length > 0 ? (
            lines.map((l, i) => {
              const text = p.drafts[l.id] ?? l.text;
              const dirty = text !== l.text;
              return (
                <div key={l.id} className="ed-line">
                  <label className="ed-sr" htmlFor={i === 0 ? 'ed-said' : `ed-said-${l.id}`}>
                    {lines.length > 1 ? `Words for this step, line ${i + 1}` : 'Words for this step'}
                  </label>
                  <textarea
                    id={i === 0 ? 'ed-said' : `ed-said-${l.id}`}
                    className="ed-textarea"
                    rows={lines.length > 1 ? 3 : 4}
                    value={text}
                    maxLength={600}
                    onChange={(e) => p.onDraft(l.id, e.target.value === l.text ? null : e.target.value)}
                  />
                  {dirty && !p.voicing.has(l.id) && (
                    <div className="ed-row">
                      <Button
                        size="sm"
                        variant="silver"
                        disabled={!text.trim()}
                        onClick={() => p.onRevoice(l, text.trim())}
                      >
                        <Glyph name="mic" size={12} />
                        Re-voice this line
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => p.onDraft(l.id, null)}>
                        Revert
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <NoLine step={p.step} drafts={p.drafts} onDraft={p.onDraft} busy={busy} onVoice={p.onVoiceStep} />
          )}
        </div>

        <div className="ed-sec">
          <div className="ed-sec-h">
            <Glyph name="box" size={12} />
            <span>On screen</span>
            <span className="ed-grow" />
            <span className="ed-count">{overlays.length}</span>
          </div>
          {overlays.length ? (
            <ul className="ed-ovlist">
              {overlays.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="ed-ovrow"
                    aria-pressed={o.id === p.selected}
                    onClick={() => p.onSelect(o.id === p.selected ? null : o.id)}
                  >
                    <IconTile icon={overlayIcon(o)} />
                    <span className="ed-grow ed-ovrow-t">
                      <b>{overlayName(o, p.names[o.component])}</b>
                      {overlayText(o) && <small>{overlayText(o)}</small>}
                    </span>
                    <span className="ed-tab ed-muted">{mmss(o.start)}</span>
                  </button>
                  {sel?.id === o.id && (
                    <OverlayEditor
                      key={`${o.id}:${JSON.stringify(o.props)}`}
                      o={o}
                      onEdit={(c, label) => p.onEditOverlay(o, c, label)}
                      onRemove={() => p.onRemoveOverlay(o)}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ed-muted ed-s13">Nothing extra on screen in this step.</p>
          )}
          <div className="ed-row" role="group" aria-label="Add to the screen">
            {(
              [
                ['arrow', 'arrow', 'Arrow', 'Click what to point at'],
                ['label', 'label', 'Label', 'Adds a label at the playhead'],
                ['box', 'box', 'Box', 'Click what to outline'],
                ['blur', 'hide', 'Hide', 'Click what to hide'],
              ] as [AddKind, GlyphName, string, string][]
            ).map(([k, icon, label, title]) => (
              <Button key={k} size="sm" onClick={() => p.onAdd(k)} title={title} data-add={k}>
                <Glyph name={icon} size={12} />
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="ed-sec">
          <div className="ed-sec-h">
            <Glyph name="gauge" size={12} />
            <span id="ed-pace-h">Pace</span>
          </div>
          <div role="group" aria-labelledby="ed-pace-h" className="ui-seg ui-seg-block" id="ed-pace">
            {(
              [
                ['normal', 'Normal'],
                ['fast', 'Faster'],
                ['skip', 'Skip'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className="ui-seg-item"
                aria-pressed={p.pace.kind === k}
                disabled={p.paceBusy}
                onClick={() => p.pace.kind !== k && p.onPace(k)}
              >
                {label}
                {k === 'fast' && p.pace.kind === 'fast' && p.pace.rate !== 2 ? ` (${p.pace.rate}×)` : ''}
              </button>
            ))}
          </div>
          <p className="ed-muted ed-s12">{p.paceBusy ? 'Changing the pace…' : PACE_TEXT[p.pace.kind]}</p>
        </div>
      </div>
    </section>
  );
}

/** A step with no voice line yet: its script, and a button to voice it. */
function NoLine({
  step,
  drafts,
  onDraft,
  busy,
  onVoice,
}: {
  step: Step;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string | null) => void;
  busy: boolean;
  onVoice: (text: string) => void;
}) {
  const key = `step:${step.id}`;
  const text = drafts[key] ?? step.narration;
  return (
    <div className="ed-line">
      <label className="ed-sr" htmlFor="ed-said">
        Words for this step
      </label>
      <textarea
        id="ed-said"
        className="ed-textarea"
        rows={4}
        value={text}
        maxLength={600}
        placeholder="What the narrator says during this step"
        onChange={(e) => onDraft(key, e.target.value === step.narration ? null : e.target.value)}
      />
      {!busy && text.trim() && (
        <div className="ed-row">
          <Button size="sm" variant="silver" onClick={() => onVoice(text.trim())}>
            <Glyph name="mic" size={12} />
            Voice this line
          </Button>
          {drafts[key] !== undefined && (
            <Button size="sm" variant="quiet" onClick={() => onDraft(key, null)}>
              Revert
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const DURATIONS = [2, 4, 6];

/** Text, colour, how long it shows, and Remove, for one overlay. */
function OverlayEditor({
  o,
  onEdit,
  onRemove,
}: {
  o: OverlayInstance;
  onEdit: (change: { props?: Record<string, unknown>; end?: number }, label: string) => void;
  onRemove: () => void;
}) {
  const prop = textProp(o.component);
  const props = o.props as Record<string, unknown>;
  const [text, setText] = useState(prop ? String(props[prop] ?? '') : '');
  const len = Math.round((o.end - o.start) * 10) / 10;
  const name = overlayName(o).toLowerCase();
  const commitText = () => {
    if (prop && text !== String(props[prop] ?? '')) onEdit({ props: { ...props, [prop]: text } }, `Change ${name} text`);
  };
  const colours =
    o.component === 'core:TextLabel'
      ? LABEL_TONES.map((t) => ({ value: t.value, name: t.name, swatch: t.swatch, on: (props.tone ?? 'dark') === t.value, key: 'tone' }))
      : o.component === 'core:Arrow' || o.component === 'core:Box'
        ? VIDEO_COLORS.map((c) => ({
            value: c.value,
            name: c.name,
            swatch: c.value,
            on: String(props.color ?? VIDEO_COLORS[0]!.value).toLowerCase() === c.value.toLowerCase(),
            key: 'color',
          }))
        : [];
  return (
    <div className="k-inset ed-oved">
      {prop && (
        <div className="ed-field">
          <label className="ed-lbl" htmlFor={`ed-ovt-${o.id}`}>
            {prop === 'title' ? 'Title' : 'Text'}
          </label>
          <input
            id={`ed-ovt-${o.id}`}
            className="ed-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
      )}
      {colours.length > 0 && (
        <div className="ed-field">
          <span className="ed-lbl" id={`ed-ovc-${o.id}`}>
            Colour
          </span>
          <div className="ed-swatches" role="group" aria-labelledby={`ed-ovc-${o.id}`}>
            {colours.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.name}
                title={c.name}
                aria-pressed={c.on}
                style={{ background: c.swatch }}
                onClick={() => !c.on && onEdit({ props: { ...props, [c.key]: c.value } }, `Change ${name} colour`)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="ed-field">
        <span className="ed-lbl" id={`ed-ovd-${o.id}`}>
          Shows for <span className="ed-muted ed-tab">({len} s)</span>
        </span>
        <div className="ui-seg" role="group" aria-labelledby={`ed-ovd-${o.id}`}>
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              className="ui-seg-item"
              aria-pressed={Math.abs(len - d) < 0.05}
              onClick={() => onEdit({ end: o.start + d }, `Show ${name} for ${d} s`)}
            >
              {d} s
            </button>
          ))}
        </div>
      </div>
      {(o.anchor || o.rect) && <p className="ed-muted ed-s12">Drag it on the video to move it.</p>}
      <div className="ed-row">
        <Button size="sm" variant="danger" onClick={onRemove}>
          <Glyph name="trash" size={12} />
          Remove
        </Button>
      </div>
    </div>
  );
}
