import { useEffect, useState } from 'react';
import type { PipelineProgress } from '@studio/core';
import { Dots, Glyph, Shell, ShellHeader, ShellPanel, StatusPill } from '@studio/ui';
import type { LiveView } from './useLiveView';

/** Frames older than this mean the screencast has paused. */
const FRESH_MS = 4000;

/**
 * What the agent sees in the product while it tests and records, with its pointer and the
 * element it is about to use. Before testing starts a planning placeholder; in stages without
 * a screen (voice-over, editing) the stage's items.
 */
export function LiveViewPanel({
  live,
  planning,
  label,
  progress,
  media,
  working = true,
}: {
  live: LiveView;
  /** Before the product opens (planning). */
  planning: boolean;
  /** What is happening now, for the placeholder. */
  label: string;
  progress: PipelineProgress | null;
  media: (rel: string, version?: number) => string | null;
  /** Whether the agent is working now (dots), or waiting. */
  working?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const running = live.session?.state === 'started';
  const fresh = running && !!live.frame && now - live.frameAt < FRESH_MS;
  const fw = live.session?.frame?.width ?? 1;
  const fh = live.session?.frame?.height ?? 1;
  const showFrame = !!live.frame && (running || !progress?.items.length);

  return (
    <Shell aria-label="Live view">
      <ShellHeader
        icon="film"
        title="Live view"
        subtitle={planning ? 'The product opens when testing starts' : 'What the agent sees in the product'}
        aside={
          fresh ? (
            <StatusPill tone="negative" busy>
              Live
            </StatusPill>
          ) : running ? (
            <StatusPill busy>Starting the product</StatusPill>
          ) : undefined
        }
      />
      <ShellPanel className="mk-live-panel">
        {showFrame ? (
          <div className="mk-live-frame" data-stale={running ? undefined : 'true'}>
            <img src={live.frame!} alt="The product as the agent sees it" />
            {running && live.action && live.session?.frame && (
              <>
                <span
                  className="mk-live-target"
                  aria-hidden="true"
                  style={{
                    left: `${(live.action.bbox.x / fw) * 100}%`,
                    top: `${(live.action.bbox.y / fh) * 100}%`,
                    width: `${(live.action.bbox.w / fw) * 100}%`,
                    height: `${(live.action.bbox.h / fh) * 100}%`,
                  }}
                />
                <span
                  className="mk-live-target-label"
                  style={{
                    left: `${(live.action.bbox.x / fw) * 100}%`,
                    top: `${(live.action.bbox.y / fh) * 100}%`,
                  }}
                >
                  {live.action.kind === 'type' ? 'Types into' : 'Clicks'} {live.action.label}
                </span>
              </>
            )}
            {running && live.pointer && live.session?.frame && (
              <span
                className="mk-live-pointer"
                aria-hidden="true"
                style={{ left: `${(live.pointer.x / fw) * 100}%`, top: `${(live.pointer.y / fh) * 100}%` }}
              >
                {live.pointer.clickAt > 0 && <span key={live.pointer.clickAt} className="mk-live-ring" />}
                <svg width={20} height={23} viewBox="0 0 24 28">
                  <path d="M2 2l18 11-8 2-3 9z" />
                </svg>
              </span>
            )}
            {!running && <span className="mk-live-paused">Last screen</span>}
          </div>
        ) : progress?.items.length ? (
          <div className="mk-live-items">
            <p className="mk-live-items-title">{progress.message}</p>
            <ol>
              {progress.items.map((it) => (
                <li key={it.id} data-state={it.state}>
                  <span className="mk-live-mark" aria-hidden="true">
                    {it.state === 'done' ? (
                      <Glyph name="check" size={12} />
                    ) : it.state === 'failed' ? (
                      <Glyph name="x" size={12} />
                    ) : it.state === 'active' ? (
                      <span className="k-spin" />
                    ) : null}
                  </span>
                  <span className="mk-live-item-label">{it.label}</span>
                  <span className="ui-sr-only">{it.state}</span>
                  {it.detail && <span className="mk-live-item-detail">{it.detail}</span>}
                  {it.image && media(it.image, progress.version) && (
                    <img
                      className="mk-live-item-image"
                      src={media(it.image, progress.version)!}
                      alt={`${it.label}: picture`}
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="mk-live-empty">
            {working ? <Dots /> : <Glyph name="pause" size={14} />}
            <b>{planning && working ? 'Reading and planning' : label}</b>
            <span>{planning && working ? 'Usually about 4 minutes' : 'Nothing on screen right now'}</span>
          </div>
        )}
      </ShellPanel>
      <p className="mk-live-note">
        You can close this window. You’ll get a notification when it needs you or is ready.
      </p>
    </Shell>
  );
}
