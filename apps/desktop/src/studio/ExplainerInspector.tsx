import { useState } from 'react';
import { resolveBeats, type ExplainerScene, type TimelinePatch, type VoiceLine } from '@studio/core';
import type { OverlayModule } from '@studio/overlay-sdk';
import { looksFor } from '@studio/scenes-core';
import { Button, Chip, Panel, Segmented, TextArea } from '@studio/ui';

/**
 * The selected explainer scene: its narration lines (each edit is one patch; beats re-time
 * from the text, or from the voice-over once it is regenerated), the resolved beat times,
 * its look (built-ins that share props), its length and its props as JSON (checked against the component's schema). The parent keys
 * it by the scene's narration and props, so outside changes (undo, the agent) reset the fields.
 */
export function ExplainerInspector({
  scene,
  index,
  voice,
  mod,
  patch,
  onClose,
}: {
  scene: ExplainerScene;
  index: number;
  voice: VoiceLine[];
  mod: OverlayModule | undefined;
  patch: (p: TimelinePatch, opts?: { group?: string; label?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [lines, setLines] = useState(scene.narration);
  const [props, setProps] = useState(JSON.stringify(scene.props, null, 2));
  const [propsError, setPropsError] = useState<string | null>(null);

  const looks = looksFor(scene.component);
  const timing = resolveBeats(scene, voice, mod?.meta?.beats ?? []);
  const voiced = voice.length > 0;
  const saveLines = (next: string[]) =>
    void patch([{ op: 'replace', path: `/scenes/${index}/narration`, value: next }], {
      group: `narration-${scene.id}`,
      label: 'Edit explainer narration',
    });

  return (
    <Panel
      title="Explainer"
      action={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
        {scene.component} · {scene.id}
      </span>
      {looks.length > 1 && (
        <>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ui-navy)' }}>Look</span>
          <Segmented
            label="Explainer look"
            block
            options={looks.map((l) => ({ value: l.id, label: l.label }))}
            value={scene.component}
            onChange={(component) =>
              void patch([{ op: 'replace', path: `/scenes/${index}/component`, value: component }], {
                label: 'Change explainer look',
              })
            }
          />
        </>
      )}
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ui-navy)' }}>Narration</span>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span
            className="ui-mono"
            style={{ fontSize: 11, color: 'var(--ui-gray-600)', paddingTop: 8, width: 18 }}
          >
            {i + 1}
          </span>
          <TextArea
            aria-label={`Narration line ${i + 1}`}
            rows={2}
            value={l}
            style={{ flex: 1 }}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? e.target.value : x)))}
            onBlur={() => lines[i] !== scene.narration[i] && saveLines(lines)}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove line ${i + 1}`}
            onClick={() => saveLines(lines.filter((_, j) => j !== i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button size="sm" onClick={() => saveLines([...lines, ''])}>
        Add a line
      </Button>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ui-navy)' }}>
        Beats {voiced ? '(from the voice-over)' : '(estimated from the text until it is voiced)'}
      </span>
      {timing.order.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
          This scene has no beats; the component spreads its steps over the scene.
        </span>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
          {timing.order.map((id) => (
            <li key={id}>
              <span className="ui-mono">{id}</span> at {timing.beats[id]!.toFixed(2)} s
            </li>
          ))}
        </ul>
      )}
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ui-navy)' }}>Length</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Chip>{scene.duration === 'auto' ? 'Follows the narration' : `${scene.duration} s`}</Chip>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void patch(
              [
                {
                  op: 'replace',
                  path: `/scenes/${index}/duration`,
                  value: scene.duration === 'auto' ? 6 : 'auto',
                },
              ],
              {
                label: 'Explainer length',
              },
            )
          }
        >
          {scene.duration === 'auto' ? 'Fix at 6 s' : 'Follow narration'}
        </Button>
      </div>
      <label htmlFor={`props-${scene.id}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--ui-navy)' }}>
        Props (JSON)
      </label>
      <TextArea
        id={`props-${scene.id}`}
        rows={8}
        value={props}
        className="ui-mono"
        style={{ fontSize: 12 }}
        onChange={(e) => setProps(e.target.value)}
        onBlur={() => {
          try {
            const value = JSON.parse(props) as Record<string, unknown>;
            const check = mod?.meta?.props?.safeParse(value);
            if (check && !check.success) {
              setPropsError(check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
              return;
            }
            setPropsError(null);
            if (JSON.stringify(value) !== JSON.stringify(scene.props))
              void patch([{ op: 'replace', path: `/scenes/${index}/props`, value }], {
                label: 'Edit explainer props',
              });
          } catch (e) {
            setPropsError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
      {propsError && <Chip tone="error">{propsError}</Chip>}
    </Panel>
  );
}
