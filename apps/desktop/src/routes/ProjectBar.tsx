import { useEffect, useState } from 'react';
import { partContext, PIPELINE_STAGES, type Gate, type ProjectSummary, type Series } from '@studio/core';
import { Button, LinkButton } from '@studio/ui';
import { useEngine } from '../engine';
import { usePipeline } from '../pipeline';
import { liveRoute } from './frame';
import { projectRoute } from './projects/ProjectsScreen';

export type ProjectScreen = 'brief' | 'storyboard' | 'live' | 'studio';

/** Where each kind of gate is answered: plans and lines on the storyboard, the rest in the Studio. */
const GATE_SCREEN: Record<Gate['kind'], ProjectScreen> = {
  storyboard: 'storyboard',
  narration: 'storyboard',
  help: 'studio',
  knowledge: 'studio',
};
const GATE_ACTION: Record<Gate['kind'], string> = {
  storyboard: 'Review the plan',
  narration: 'Review the narration',
  help: 'Help the agent',
  knowledge: 'Review what the agent learned',
};

const href = (screen: ProjectScreen, slug: string) =>
  screen === 'live' ? `#${liveRoute(slug)}` : `#/${screen}/${slug}`;

/**
 * The open project across its screens: its name, links between Brief, Storyboard, Live and
 * Studio, what the pipeline is doing, and, when it waits for the user, what it needs with a
 * button to the screen where it's answered.
 */
export function ProjectBar({ slug, current }: { slug: string; current: ProjectScreen }) {
  const { client, state: conn } = useEngine();
  const pipe = usePipeline(slug);
  const [title, setTitle] = useState<string | null>(null);
  const [series, setSeries] = useState<{ series: Series; part: string; projects: ProjectSummary[] } | null>(
    null,
  );

  useEffect(() => {
    if (!client || conn !== 'open') return;
    let live = true;
    const load = async () => {
      const list = await client.call('project.list', {});
      const p = list.find((x) => x.slug === slug);
      if (!live) return;
      setTitle(p?.title ?? null);
      const s = p?.series ? await client.call('series.get', { slug: p.series.slug }).catch(() => null) : null;
      if (live) setSeries(s && p?.series ? { series: s, part: p.series.part, projects: list } : null);
    };
    void load().catch(() => undefined);
    const off = client.on('series.changed', () => void load().catch(() => undefined));
    return () => {
      live = false;
      off();
    };
  }, [client, conn, slug]);

  const st = pipe.state;
  const gate = st?.status === 'waiting' ? st.gate : null;
  const needs = gate ? GATE_SCREEN[gate.kind] : null;
  const stage = PIPELINE_STAGES.find((s) => s.stage === st?.stage)?.label;
  const doing =
    st?.status === 'running' && stage
      ? `Now: ${stage}`
      : st?.status === 'done'
        ? 'Pipeline finished'
        : st?.status === 'failed'
          ? `Failed at ${stage?.toLowerCase() ?? 'a stage'}`
          : st?.status === 'stopped' && stage
            ? `Stopped at ${stage.toLowerCase()}`
            : null;
  const resumable = (st?.status === 'stopped' || st?.status === 'failed') && !!st.stage;

  const screens: { key: ProjectScreen; label: string }[] = [
    { key: 'brief', label: 'Brief' },
    { key: 'storyboard', label: 'Storyboard' },
    { key: 'live', label: 'Live' },
    { key: 'studio', label: 'Studio' },
  ];

  const ctx = series ? partContext(series.series, series.part) : null;
  /** A neighbouring part: its tutorial's current screen, or the series when it has none. */
  const partHref = (project: string | null) => {
    const p = project ? series?.projects.find((x) => x.slug === project) : undefined;
    return p ? `#${projectRoute(p)}` : `#/series/${series?.series.slug ?? ''}`;
  };

  return (
    <>
      {series && ctx && (
        <nav className="series-nav" aria-label="Series">
          {ctx.prev ? (
            <a className="series-nav-side" href={partHref(ctx.prev.project)}>
              ← <span className="series-nav-muted">Part {ctx.number - 1} ·</span> {ctx.prev.title}
            </a>
          ) : (
            <span className="series-nav-side" />
          )}
          <a className="series-nav-mid" href={`#/series/${series.series.slug}`}>
            <strong>
              Part {ctx.number} of {ctx.total}
            </strong>
            <span className="series-nav-muted">{series.series.title}</span>
          </a>
          {ctx.next ? (
            <a className="series-nav-side series-nav-next" href={partHref(ctx.next.project)}>
              <span className="series-nav-muted">Part {ctx.number + 1} ·</span> {ctx.next.title} →
            </a>
          ) : (
            <span className="series-nav-side" />
          )}
        </nav>
      )}
      <nav className="project-bar" data-waiting={gate ? 'true' : undefined} aria-label="Project">
        <strong className="project-bar-title" title={title ?? slug}>
          {title ?? slug}
        </strong>
        <span className="project-bar-links">
          {screens.map((s) => (
            <a
              key={s.key}
              href={href(s.key, slug)}
              aria-current={s.key === current ? 'page' : undefined}
              className="project-bar-link"
            >
              {s.label}
              {needs === s.key && <span className="project-bar-dot" aria-label="needs you" />}
            </a>
          ))}
        </span>
        {gate ? (
          <span className="project-bar-gate" role="status">
            <span className="project-bar-gate-title">{gate.title}</span>
            {needs !== current && (
              <LinkButton variant="primary" size="sm" href={href(needs!, slug)}>
                {GATE_ACTION[gate.kind]} →
              </LinkButton>
            )}
          </span>
        ) : (
          doing && (
            <span className="project-bar-doing" role="status">
              {st?.status === 'running' && <span className="project-bar-pulse" aria-hidden="true" />}
              {doing}
              {resumable && (
                <Button size="sm" disabled={!pipe.ready} onClick={() => void pipe.resume()}>
                  Resume
                </Button>
              )}
            </span>
          )
        )}
      </nav>
    </>
  );
}
