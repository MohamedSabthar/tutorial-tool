import { useEffect, useState } from 'react';
import { PIPELINE_STAGES, type Gate } from '@studio/core';
import { Button, LinkButton } from '@studio/ui';
import { useEngine } from '../engine';
import { usePipeline } from '../pipeline';
import { liveRoute } from './frame';

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

  useEffect(() => {
    if (!client || conn !== 'open') return;
    void client.call('project.list', {}).then(
      (list) => setTitle(list.find((p) => p.slug === slug)?.title ?? null),
      () => undefined,
    );
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

  return (
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
  );
}
