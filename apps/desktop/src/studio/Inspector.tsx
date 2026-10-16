import { useMemo } from 'react';
import { z } from 'zod';
import type { OverlayInstance, Timeline, TimelinePatch } from '@studio/core';
import type { OverlayModule } from '@studio/overlay-sdk';
import { Button, Chip, Field, Input, Panel, Segmented, Select, Switch, TextArea } from '@studio/ui';

interface PropSchema {
  type?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  items?: { type?: string };
}

/** JSON Schema of a component's props (zod 4), or null when it can't be described. */
function propsSchema(mod: OverlayModule | undefined): Record<string, PropSchema> | null {
  try {
    const js = z.toJSONSchema(mod?.meta.props as z.ZodType, { io: 'input', unrepresentable: 'any' }) as {
      properties?: Record<string, PropSchema>;
    };
    return js.properties ?? {};
  } catch {
    return null;
  }
}

const label = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/**
 * Edits the selected overlay: timing, anchor, and a form generated from the component's
 * zod props. Every field edit is a patch; a focus session on one field is one undo step.
 */
export function Inspector({
  timeline,
  overlay,
  module,
  patch,
  onOpenSource,
}: {
  timeline: Timeline;
  overlay: OverlayInstance | null;
  module: OverlayModule | undefined;
  patch: (p: TimelinePatch, opts?: { group?: string; label?: string }) => Promise<void>;
  onOpenSource?: (component: string) => void;
}) {
  const schema = useMemo(() => propsSchema(module), [module]);

  if (!overlay) {
    return (
      <Panel title="Inspector">
        <span style={{ color: 'var(--ui-gray-600)' }}>Select an overlay on the timeline or the preview.</span>
      </Panel>
    );
  }
  const index = timeline.overlays.findIndex((o) => o.id === overlay.id);
  const base = `/overlays/${index}`;
  // Consecutive edits to one field (typing) are one undo step; any other edit starts a new one.
  const set = (path: string, value: unknown, field: string, op: 'replace' | 'add' = 'replace') =>
    void patch([{ op, path: `${base}${path}`, value }], {
      group: `field-${overlay.id}-${field}`,
      label: `Edit ${field}`,
    });

  const propValue = (k: string, s: PropSchema) => (k in overlay.props ? overlay.props[k] : s.default);
  const anchoredSteps = timeline.steps.filter((s) => s.bbox);
  const custom = !overlay.component.startsWith('core:');

  return (
    <Panel title="Inspector" action={<Chip mono>{overlay.id}</Chip>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong style={{ color: 'var(--ui-navy)' }}>{module?.meta.name ?? overlay.component}</strong>
        <span style={{ fontSize: 11, color: 'var(--ui-gray-600)', lineHeight: 1.4 }}>
          {overlay.component} · {module?.meta.description ?? 'component not loaded'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {(['start', 'end'] as const).map((k) => (
          <Field key={k} label={label(k)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                step={0.05}
                className="ui-mono"
                value={overlay[k]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) set(`/${k}`, Math.round(v * 1000) / 1000, k);
                }}
              />
            )}
          </Field>
        ))}
      </div>

      <Field
        label="Anchor"
        hint={
          overlay.rect ? 'Placed by hand on the preview (drag it onto an element to re-anchor).' : undefined
        }
      >
        {(id) => (
          <Select
            id={id}
            value={overlay.anchor?.stepId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                if (overlay.anchor)
                  void patch([{ op: 'remove', path: `${base}/anchor` }], { label: 'Remove anchor' });
              } else {
                const ops: TimelinePatch = [
                  {
                    op: overlay.anchor ? 'replace' : 'add',
                    path: `${base}/anchor`,
                    value: { stepId: v, target: 'primary' },
                  },
                ];
                if (overlay.rect) ops.push({ op: 'remove', path: `${base}/rect` });
                void patch(ops, { label: 'Set anchor' });
              }
            }}
          >
            <option value="">None</option>
            {anchoredSteps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.title}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {schema === null && <Chip tone="error">This component’s props can’t be described as a form.</Chip>}
      {schema &&
        Object.entries(schema).map(([k, s]) => {
          const v = propValue(k, s);
          const path = `/props/${k}`;
          const op = k in overlay.props ? 'replace' : 'add';
          if (s.type === 'boolean')
            return <Switch key={k} label={label(k)} checked={!!v} onChange={(b) => set(path, b, k, op)} />;
          if (s.enum && s.enum.length <= 4)
            return (
              <Field key={k} label={label(k)}>
                {() => (
                  <Segmented
                    label={label(k)}
                    options={s.enum as string[]}
                    value={String(v ?? s.enum![0])}
                    onChange={(x) => set(path, x, k, op)}
                  />
                )}
              </Field>
            );
          if (s.enum)
            return (
              <Field key={k} label={label(k)}>
                {(id) => (
                  <Select id={id} value={String(v ?? '')} onChange={(e) => set(path, e.target.value, k, op)}>
                    {s.enum!.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </Select>
                )}
              </Field>
            );
          if (s.type === 'number')
            return (
              <Field
                key={k}
                label={label(k)}
                hint={
                  s.minimum !== undefined && s.maximum !== undefined ? `${s.minimum}–${s.maximum}` : undefined
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={s.minimum}
                    max={s.maximum}
                    step={s.maximum !== undefined && s.maximum <= 10 ? 0.1 : 1}
                    value={Number(v ?? 0)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) set(path, n, k, op);
                    }}
                  />
                )}
              </Field>
            );
          if (s.type === 'array' && s.items?.type === 'string')
            return (
              <Field key={k} label={label(k)} hint="Comma-separated">
                {(id) => (
                  <Input
                    id={id}
                    value={(Array.isArray(v) ? v : []).join(', ')}
                    onChange={(e) =>
                      set(
                        path,
                        e.target.value
                          .split(',')
                          .map((x) => x.trim())
                          .filter(Boolean),
                        k,
                        op,
                      )
                    }
                  />
                )}
              </Field>
            );
          if (s.type === 'string' && /color/i.test(k))
            return (
              <Field key={k} label={label(k)}>
                {(id) => (
                  <Input
                    id={id}
                    type="color"
                    value={String(v ?? '#FF5800')}
                    onChange={(e) => set(path, e.target.value, k, op)}
                    style={{ padding: 2 }}
                  />
                )}
              </Field>
            );
          if (s.type === 'string') {
            const long = /text|code|subtitle/i.test(k) || String(v ?? '').length > 40;
            return (
              <Field key={k} label={label(k)}>
                {(id) =>
                  long ? (
                    <TextArea
                      id={id}
                      rows={3}
                      value={String(v ?? '')}
                      onChange={(e) => set(path, e.target.value, k, op)}
                    />
                  ) : (
                    <Input
                      id={id}
                      value={String(v ?? '')}
                      onChange={(e) => set(path, e.target.value, k, op)}
                    />
                  )
                }
              </Field>
            );
          }
          return null;
        })}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="sm"
          style={{ flex: 1 }}
          disabled={!custom}
          onClick={() => onOpenSource?.(overlay.component)}
          title={custom ? 'Open the component file in VS Code' : 'Core overlays are part of the app'}
        >
          Open source
        </Button>
        <Button
          size="sm"
          style={{ flex: 1 }}
          disabled
          title="Promoting to the shared library arrives in step 5.5"
        >
          Promote
        </Button>
      </div>
    </Panel>
  );
}
