import { useCallback, useEffect, useState } from 'react';
import type { ExplainerJob } from '@studio/core';
import { Button, Chip, Panel, TextArea } from '@studio/ui';
import { useEngine } from '../../engine';

/** Explainers being made with the agent, for the Studio: storyboards to approve, builds in progress. */
export function useExplainers(slug: string) {
  const { client, state } = useEngine();
  const [jobs, setJobs] = useState<ExplainerJob[]>([]);
  const load = useCallback(async () => {
    if (client) setJobs(await client.call('explainers.list', { slug }).catch(() => []));
  }, [client, slug]);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void Promise.resolve().then(load);
    return client.on('explainers.changed', (e) => e.slug === slug && void load());
  }, [client, state, slug, load]);
  return jobs;
}

const STATUS: Record<ExplainerJob['status'], { label: string; tone: 'info' | 'active' | 'ok' | 'neutral' }> =
  {
    storyboarding: { label: 'The agent is writing the storyboard', tone: 'info' },
    review: { label: 'Storyboard ready for review', tone: 'active' },
    building: { label: 'The agent is building it', tone: 'info' },
    done: { label: 'Done', tone: 'ok' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  };

/**
 * The storyboard of an explainer the agent is making: one card per beat with its rough frame
 * (from check_scene), narration (editable) and visual, then Approve and build, Ask for changes,
 * or Cancel (removes the scene).
 */
export function ExplainerStoryboard({
  slug,
  job,
  onSeek,
}: {
  slug: string;
  job: ExplainerJob;
  onSeek?: () => void;
}) {
  const { client, info } = useEngine();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const media = (rel: string) =>
    info ? `http://127.0.0.1:${info.port}/media/${slug}/${rel}?token=${encodeURIComponent(info.token)}` : '';
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const [designed, setDesigned] = useState<{ id: string; path: string; series: boolean } | null>(null);
  const [promoted, setPromoted] = useState(false);
  // A scene the agent wrote (not a built-in or library one): its file, for the badge and actions.
  useEffect(() => {
    if (!client) return;
    let live = true;
    void (async () => {
      const { timeline } = await client.call('timeline.get', { slug });
      const scene = timeline.scenes.find((x) => x.id === job.sceneId);
      const id = scene?.kind === 'explainer' ? scene.component : null;
      const entry =
        id && /^(project|series):/.test(id)
          ? (await client.call('overlays.list', { slug })).find((e) => e.id === id)
          : undefined;
      if (live) setDesigned(id && entry ? { id, path: entry.path, series: entry.scope === 'series' } : null);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, slug, job.sceneId, job.status, job.frames]);
  const st = STATUS[job.status];
  const sb = job.storyboard;
  return (
    <Panel
      title={`Explainer storyboard · ${sb?.title ?? job.brief}`}
      action={
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Chip tone={st.tone}>{st.label}</Chip>
          {onSeek && (
            <Button size="sm" variant="ghost" onClick={onSeek}>
              Go to scene
            </Button>
          )}
        </span>
      }
    >
      {sb?.approach && (
        <span style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
          <b style={{ color: 'var(--ui-navy)' }}>Approach:</b> {sb.approach}
        </span>
      )}
      {!sb && <span style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>“{job.brief}”</span>}
      {designed && (
        <div className="xsb-designed">
          <Chip tone="info">
            {designed.series ? 'Designed for this series' : 'Designed for this tutorial'}
          </Chip>
          <span className="ui-mono xsb-designed-path">{designed.path}</span>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void act('code', () => client!.call('project.reveal', { slug, path: `../../${designed.path}` }))
            }
          >
            View code
          </Button>
          <Button
            size="sm"
            disabled={!!busy || promoted}
            onClick={() =>
              void act('promote', async () => {
                await client!.call('library.promote', { slug, id: designed.id });
                setPromoted(true);
              })
            }
          >
            {promoted ? 'In the library' : busy === 'promote' ? 'Checking…' : 'Save to library'}
          </Button>
        </div>
      )}
      {sb && (
        <div className="xsb-cards">
          {sb.beats.map((b, i) => (
            <article key={b.id} className="xsb-card" aria-label={`Beat ${i + 1}: ${b.id}`}>
              {job.frames[b.id] ? (
                <img src={media(job.frames[b.id]!)} alt={`Rough frame for ${b.id}`} />
              ) : (
                <div className="xsb-noframe">No frame yet</div>
              )}
              <span className="xsb-beat">
                <span className="ui-mono">{i + 1}</span> {b.id}
              </span>
              <TextArea
                aria-label={`Narration for ${b.id}`}
                rows={3}
                defaultValue={b.narration}
                readOnly={job.status !== 'review'}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== b.narration)
                    void act('edit', () =>
                      client!.call('explainers.editBeat', {
                        slug,
                        sceneId: job.sceneId,
                        beatId: b.id,
                        narration: v,
                      }),
                    );
                }}
              />
              {b.visual && <span className="xsb-visual">{b.visual}</span>}
            </article>
          ))}
        </div>
      )}
      {job.status === 'done' && job.summary && <span style={{ fontSize: 13 }}>{job.summary}</span>}
      {error && <Chip tone="error">{error}</Chip>}
      {job.status === 'review' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <Button
            variant="primary"
            disabled={!!busy}
            onClick={() =>
              void act('approve', () => client!.call('explainers.approve', { slug, sceneId: job.sceneId }))
            }
          >
            {busy === 'approve' ? 'Starting…' : 'Approve and build'}
          </Button>
          <TextArea
            aria-label="Changes to ask for"
            rows={1}
            placeholder="Ask for changes, e.g. add a beat for the response"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            style={{ flex: '1 1 240px' }}
          />
          <Button
            disabled={!feedback.trim() || !!busy}
            onClick={() =>
              void act('revise', async () => {
                await client!.call('explainers.revise', {
                  slug,
                  sceneId: job.sceneId,
                  feedback: feedback.trim(),
                });
                setFeedback('');
              })
            }
          >
            Ask for changes
          </Button>
          {designed && (
            <Button
              disabled={!!busy}
              onClick={() =>
                void act('builtin', () =>
                  client!.call('explainers.revise', {
                    slug,
                    sceneId: job.sceneId,
                    feedback:
                      'Use a built-in look instead of the designed scene: pick the built-in scene (list_scenes) that shows this idea best, and keep the beats and narration.',
                  }),
                )
              }
            >
              Use a built-in look instead
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={() => {
              if (window.confirm('Cancel this explainer and remove its scene?'))
                void act('cancel', () => client!.call('explainers.cancel', { slug, sceneId: job.sceneId }));
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </Panel>
  );
}
