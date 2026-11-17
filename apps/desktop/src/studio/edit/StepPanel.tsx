import { useState } from 'react';
import type { LateCueFix, OverlayInstance, Step, Timeline, VoiceLine } from '@studio/core';
import { Button, Glyph, IconTile, Menu, MenuItem, MenuLabel, MenuSeparator, StatusPill, type GlyphName } from '@studio/ui';
import { FloatPopover } from './FloatPopover';
import type { StepSpan } from '../resolve';
import {
  LABEL_TONES,
  mmss,
  overlayIcon,
  overlayName,
  overlayText,
  overlaysIn,
  parseKeys,
  textFields,
  VIDEO_COLORS,
  type Pace,
} from './model';

/** What "+ Add" can put on screen; `own` is one of your own overlays (its component in `component`). */
export type AddKind = 'arrow' | 'box' | 'highlight' | 'callout' | 'zoom' | 'label' | 'keys' | 'title' | 'blur' | 'own';

const ADD_GROUPS: { label: string; items: { k: AddKind; icon: GlyphName; name: string; hint: string }[] }[] = [
  {
    label: 'Point something out',
    items: [
      { k: 'arrow', icon: 'arrow', name: 'Arrow', hint: 'Click what to point at' },
      { k: 'box', icon: 'box', name: 'Box', hint: 'Click what to outline' },
      { k: 'highlight', icon: 'search', name: 'Highlight', hint: 'Dims the rest of the screen' },
      { k: 'callout', icon: 'label', name: 'Callout', hint: 'A note next to what you click' },
    ],
  },
  {
    label: 'Zoom in',
    items: [{ k: 'zoom', icon: 'expand', name: 'Zoom into an area', hint: 'Drag over the video for about 3 s' }],
  },
  {
    label: 'Text',
    items: [
      { k: 'label', icon: 'label', name: 'Label', hint: 'A short line of text' },
      { k: 'keys', icon: 'dots', name: 'Keys', hint: 'Shows a shortcut, like ⌘ S' },
      { k: 'title', icon: 'film', name: 'Title card', hint: 'A title over the video' },
    ],
  },
  {
    label: 'Hide',
    items: [{ k: 'blur', icon: 'hide', name: 'Blur', hint: 'Click a key, email or name to hide' }],
  },
];

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
  onAdd: (kind: AddKind, component?: string) => void;
  /** Your own overlays (workspace, series and project), by component. */
  own: { id: string; name: string; scope: string }[];
  /** Saves a project overlay to the shared library. */
  onPromote: (component: string) => void;
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
                <div key={`${l.id}:${i}`} className="ed-line">
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
                      name={overlayName(o, p.names[o.component])}
                      onPromote={o.component.startsWith('project:') ? () => p.onPromote(o.component) : null}
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
          <AddMenu own={p.own} onAdd={p.onAdd} />
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
const ZOOMS = [1.5, 2, 3];

/** "+ Add": everything that can go on screen, grouped by what it's for. */
function AddMenu({ own, onAdd }: { own: StepPanelProps['own']; onAdd: StepPanelProps['onAdd'] }) {
  const [open, setOpen] = useState(false);
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const pick = (k: AddKind, component?: string) => {
    setOpen(false);
    onAdd(k, component);
  };
  return (
    <div className="ed-row">
      <button
        ref={setBtn}
        type="button"
        className="ui-btn ui-btn-secondary ui-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add something on screen at the playhead"
        onClick={() => setOpen((v) => !v)}
        data-add="menu"
      >
        <Glyph name="plus" size={12} />
        Add
      </button>
      <FloatPopover anchor={btn} open={open} onClose={() => setOpen(false)} label="Add to the screen" minWidth={280}>
        <Menu label="Add to the screen">
          {ADD_GROUPS.map((g, i) => (
            <div key={g.label} role="group" aria-label={g.label}>
              {i > 0 && <MenuSeparator />}
              <MenuLabel>{g.label}</MenuLabel>
              {g.items.map((it) => (
                <MenuItem key={it.k} icon={it.icon} hint={it.hint} onSelect={() => pick(it.k)}>
                  <span data-add={it.k}>{it.name}</span>
                </MenuItem>
              ))}
            </div>
          ))}
          <div role="group" aria-label="Your own">
            <MenuSeparator />
            <MenuLabel>Your own</MenuLabel>
            {own.length ? (
              own.map((o) => (
                <MenuItem key={o.id} icon="spark" hint={o.scope} onSelect={() => pick('own', o.id)}>
                  {o.name}
                </MenuItem>
              ))
            ) : (
              <p className="ed-muted ed-s12 ed-add-none">None yet. Ask the agent to make one for this tutorial.</p>
            )}
          </div>
        </Menu>
      </FloatPopover>
    </div>
  );
}

/** Words, colour, zoom, how long it shows, and Remove, for one overlay. */
function OverlayEditor({
  o,
  name: title,
  onEdit,
  onRemove,
  onPromote,
}: {
  o: OverlayInstance;
  name: string;
  onEdit: (change: { props?: Record<string, unknown>; end?: number }, label: string) => void;
  onRemove: () => void;
  onPromote: (() => void) | null;
}) {
  const fields = textFields(o.component);
  const props = o.props as Record<string, unknown>;
  const shown = (key: string, keys?: boolean) =>
    keys ? (Array.isArray(props[key]) ? (props[key] as string[]).join(' ') : '') : String(props[key] ?? '');
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, shown(f.key, f.keys)])),
  );
  const len = Math.round((o.end - o.start) * 10) / 10;
  const name = title.toLowerCase();
  const commitText = (key: string, keys?: boolean) => {
    const v = text[key] ?? '';
    if (v === shown(key, keys)) return;
    if (keys) {
      const list = parseKeys(v);
      if (list.length) onEdit({ props: { ...props, [key]: list } }, `Change ${name}`);
    } else onEdit({ props: { ...props, [key]: v } }, `Change ${name} text`);
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
  const zoom = typeof props.zoom === 'number' ? props.zoom : 1.8;
  return (
    <div className="k-inset ed-oved">
      {fields.map((f, i) => (
        <div key={f.key} className="ed-field">
          <label className="ed-lbl" htmlFor={i === 0 ? `ed-ovt-${o.id}` : `ed-ovt-${o.id}-${f.key}`}>
            {f.label}
            {f.keys && <span className="ed-muted"> (separate with spaces, like ⌘ S)</span>}
          </label>
          <input
            id={i === 0 ? `ed-ovt-${o.id}` : `ed-ovt-${o.id}-${f.key}`}
            className="ed-input"
            value={text[f.key] ?? ''}
            onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))}
            onBlur={() => commitText(f.key, f.keys)}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
      ))}
      {o.component === 'core:Zoom' && (
        <div className="ed-field">
          <span className="ed-lbl" id={`ed-ovz-${o.id}`}>
            Zoom <span className="ed-muted ed-tab">({Math.round(zoom * 10) / 10}×)</span>
          </span>
          <div className="ui-seg" role="group" aria-labelledby={`ed-ovz-${o.id}`}>
            {ZOOMS.map((z) => (
              <button
                key={z}
                type="button"
                className="ui-seg-item"
                aria-pressed={Math.abs(zoom - z) < 0.05}
                onClick={() => onEdit({ props: { ...props, zoom: z } }, `Zoom ${z}×`)}
              >
                {z}×
              </button>
            ))}
          </div>
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
        {onPromote && (
          <Button size="sm" variant="quiet" onClick={onPromote} title="Every tutorial can use it then">
            <Glyph name="upload" size={12} />
            Save to library
          </Button>
        )}
      </div>
    </div>
  );
}
