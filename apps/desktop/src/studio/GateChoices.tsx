import { useId, useState } from 'react';
import { Button } from '@studio/ui';
import type { Gate, LateCueFix } from '@studio/core';

/** A late action within this of its word after the edit counts as fixed (the engine's slack). */
const SLACK = 0.15;

function cueResult(c: LateCueFix): string {
  if (c.rate === null) return 'nothing to speed up before it: stays late';
  return c.left > SLACK
    ? `wait before it plays ${c.rate}×: still ${c.left.toFixed(1)} s late`
    : `wait before it plays ${c.rate}×: on its word`;
}

/** One line for the gate banner: how many late actions the edit can fix. */
export function cueGateSummary(gate: Gate): string | undefined {
  const cues = gate.cues;
  if (!cues?.length) return undefined;
  const fixed = cues.filter((c) => c.rate !== null && c.left <= SLACK).length;
  return fixed === cues.length
    ? 'The edit can put every one on its word. Or record again with the script fixed.'
    : `The edit can put ${fixed} of ${cues.length} on their words. Recording again fixes the script first.`;
}

/** The late actions of a cue gate, each with what the edit does with it. */
export function LateCueList({ cues }: { cues: LateCueFix[] }) {
  return (
    <ul
      aria-label="Actions that landed late"
      style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.45 }}
    >
      {cues.map((c, i) => (
        <li key={`${c.stepId}-${i}`} style={{ marginBottom: 4 }}>
          <strong style={{ color: 'var(--ui-navy)' }}>
            {c.stepId} · “{c.word}”
          </strong>{' '}
          <span className="ui-mono">{c.late.toFixed(1)} s late</span>
          <span style={{ color: 'var(--ui-gray-600)' }}>
            {' '}
            ({c.gap.toFixed(1)} s after {c.after})
          </span>
          <div
            style={{
              color: c.rate !== null && c.left <= SLACK ? 'var(--ui-steel)' : 'var(--ui-gray-600)',
            }}
          >
            {cueResult(c)}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A gate's choices as buttons (the first one primary), with "Don't ask again" where the gate
 * lets the choice be saved for the project.
 */
export function GateChoices({
  gate,
  ready,
  onChoose,
}: {
  gate: Gate;
  ready: boolean;
  onChoose: (choice: string, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const id = useId();
  if (!gate.choices?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {gate.choices.map((c, i) => (
          <Button
            key={c.id}
            size="sm"
            variant={i === 0 ? 'primary' : 'steel'}
            disabled={!ready}
            onClick={() => onChoose(c.id, remember)}
          >
            {c.label}
          </Button>
        ))}
      </div>
      {gate.remember && (
        <label htmlFor={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input id={id} type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Don't ask again for this project
        </label>
      )}
    </div>
  );
}
