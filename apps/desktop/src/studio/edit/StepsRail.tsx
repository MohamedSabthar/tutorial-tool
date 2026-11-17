import { useEffect, useRef, useState } from 'react';
import type { Step, Timeline } from '@studio/core';
import { Glyph, StatusPill } from '@studio/ui';
import type { StepSpan } from '../resolve';
import { mmss, overlaysIn, stepPace } from './model';

/**
 * A still of the recording at take time `at`: a muted video element seeked there (no canvas,
 * so the engine's media needs no CORS). Loaded only once the card scrolls into view.
 */
function StepThumb({ src, at, n }: { src: string | null; at: number; n: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <span ref={ref} className="ed-thumb" aria-hidden="true">
      {src && seen && !failed ? (
        <video
          src={`${src}#t=${at.toFixed(2)}`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="ed-thumb-n">{n}</span>
      )}
      <span className="ed-thumb-badge">{n}</span>
    </span>
  );
}

export interface RailBadges {
  /** Steps the agent is editing right now. */
  agentStep: string | null;
  /** Steps with a warning (late actions). */
  warnings: Set<string>;
  /** Steps whose script has unsaved, unvoiced edits. */
  edited: Set<string>;
}

/** The steps, one card each: still, title, length and what's special about it. */
export function StepsRail({
  timeline,
  steps,
  currentId,
  src,
  badges,
  onSeek,
}: {
  timeline: Timeline;
  steps: StepSpan[];
  currentId: string | null;
  src: string | null;
  badges: RailBadges;
  onSeek: (step: StepSpan) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  // The current card follows the playhead.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="step"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);
  const total = steps.reduce((a, s) => a + (s.end - s.start), 0);
  const byId = new Map<string, Step>(timeline.steps.map((s) => [s.id, s]));
  return (
    <nav className="k-shell ed-rail" aria-label="Steps">
      <div className="k-shead k-shead-plain">
        <div className="k-shead-text">
          <h2>Steps</h2>
          <p>
            {steps.length} step{steps.length === 1 ? '' : 's'} · {mmss(total)}
          </p>
        </div>
      </div>
      <ol ref={list} className="ed-rail-list">
        {steps.map((s, i) => {
          const step = byId.get(s.id);
          const pace = step ? stepPace(timeline, step) : { kind: 'normal' as const };
          const n = overlaysIn(timeline, s).length;
          const cur = s.id === currentId;
          const agent = badges.agentStep === s.id;
          const at = step ? step.from + Math.min(1.5, Math.max(0, (step.to - step.from) / 2)) : 0;
          return (
            <li key={s.id}>
              <button
                type="button"
                className="ed-card"
                data-agent={agent || undefined}
                aria-current={cur ? 'step' : undefined}
                onClick={() => onSeek(s)}
                aria-label={`Step ${i + 1}: ${s.title}, ${mmss(s.end - s.start)}`}
              >
                <StepThumb src={src} at={at} n={i + 1} />
                <span className="ed-card-t">{s.title}</span>
                <span className="ed-card-m">
                  <span className="ed-tab">{pace.kind === 'skip' ? '0:00' : mmss(s.end - s.start)}</span>
                  {pace.kind === 'fast' && <StatusPill size="sm">{pace.rate}×</StatusPill>}
                  {pace.kind === 'skip' && <StatusPill size="sm">Skipped</StatusPill>}
                  {n > 0 && <StatusPill size="sm">{n} on screen</StatusPill>}
                  {badges.edited.has(s.id) && (
                    <StatusPill size="sm" tone="warning">
                      Edited
                    </StatusPill>
                  )}
                  {badges.warnings.has(s.id) && (
                    <span className="ed-warn-badge" title="An action landed after its words">
                      <Glyph name="warn" size={11} />
                      <span className="ed-sr">Warning</span>
                    </span>
                  )}
                  {agent && (
                    <StatusPill size="sm" tone="brand">
                      Agent editing
                    </StatusPill>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
