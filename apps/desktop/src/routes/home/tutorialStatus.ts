import type { ProjectSummary, Series } from '@studio/core';
import type { GlyphName, Tone } from '@studio/ui';
import { formatDuration, runRoute } from '../frame';

export interface TileStatus {
  label: string;
  tone: Tone;
  icon?: GlyphName;
  busy?: boolean;
  /** Counted in a series summary as: */
  group: 'needs' | 'busy' | 'ready' | 'failed' | 'draft';
}

/** What a tutorial tile says about where its tutorial is. */
export function tileStatus(p: ProjectSummary): TileStatus {
  const { status, stage } = p.pipeline;
  if (p.capturing) return { label: 'Capturing your demo', tone: 'brand', busy: true, group: 'busy' };
  if (status === 'waiting') {
    const label =
      stage === 'storyboard_gate'
        ? 'Your turn: check the steps'
        : stage === 'narrate'
          ? 'Your turn: check the script'
          : 'Your turn';
    return { label, tone: 'warning', icon: 'warn', group: 'needs' };
  }
  if (status === 'running')
    return { label: stage === 'record' ? 'Recording' : 'Making', tone: 'brand', busy: true, group: 'busy' };
  if (p.duration !== null) return { label: 'Ready to edit', tone: 'positive', icon: 'check', group: 'ready' };
  if (status === 'failed') return { label: 'Failed', tone: 'negative', icon: 'warn', group: 'failed' };
  if (status === 'stopped') return { label: 'Stopped', tone: 'neutral', icon: 'stop', group: 'failed' };
  return { label: 'Draft', tone: 'neutral', icon: 'clock', group: 'draft' };
}

/**
 * Where a tile leads: the run while it's going or needs the user, the Studio once recorded, the
 * run again when it failed or stopped, and the brief for a draft nobody started.
 */
export function tileRoute(p: ProjectSummary): string {
  const { status } = p.pipeline;
  if (p.capturing) return `/capture/${p.slug}`;
  if (status === 'running' || status === 'waiting') return runRoute(p.slug, status);
  if (p.duration !== null) return runRoute(p.slug, 'done');
  if (status === 'failed' || status === 'stopped') return runRoute(p.slug, status);
  if (status === 'done') return runRoute(p.slug, 'done');
  return `/brief/${p.slug}`;
}

/** "today", "yesterday", "3 days ago", or a date. */
export function ago(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const days = Math.floor(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The line under a tile's title. */
export function tileMeta(p: ProjectSummary): string {
  return p.duration !== null ? `${formatDuration(p.duration)} · ${ago(p.updatedAt)}` : ago(p.updatedAt);
}

/** A series tile's summary: how many episodes are in each state. */
export function seriesSummary(series: Series, projects: readonly ProjectSummary[]) {
  const counts = { needs: 0, busy: 0, ready: 0, failed: 0, draft: 0, unmade: 0 };
  for (const part of series.parts) {
    const p = part.project ? projects.find((x) => x.slug === part.project) : undefined;
    if (!p) counts.unmade++;
    else counts[tileStatus(p).group]++;
  }
  return counts;
}
