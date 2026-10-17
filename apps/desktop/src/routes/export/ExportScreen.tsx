import { useEffect, useMemo, useState } from 'react';
import { buildTimeMap, ExportSettings, type ExportPlan, type ExportState, type Timeline } from '@studio/core';
import { Button, LinkButton, MonoBox, Progress, Segmented, Title } from '@studio/ui';
import { useEngine } from '../../engine';
import { useTimeline } from '../../studio/useTimeline';
import { AppFrame, formatDuration } from '../frame';

const RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
] as const;
const RATES = ['24', '30', '60'] as const;
const PHASES: ExportState['phase'][] = ['render', 'audio', 'concat', 'mux', 'docs', 'done'];
const DOC_STEPS = ['captions', 'stills', 'instructions', 'script'];

type ChipState = 'done' | 'active' | 'todo';

/** The sub-steps of an export, with their state, for the chips under the progress bar. */
function substeps(job: ExportState | null, settings: ExportSettings): { label: string; state: ChipState }[] {
  const o = (job?.settings ?? settings).outputs;
  const at = job ? PHASES.indexOf(job.phase) : -1;
  const doc = job?.phase === 'docs' ? DOC_STEPS.indexOf(job.detail ?? '') : at > 4 ? 99 : -1;
  const by = (active: boolean, done: boolean): ChipState => (done ? 'done' : active ? 'active' : 'todo');
  const out: { label: string; state: ChipState }[] = [];
  if (o.video)
    out.push(
      { label: 'Voice-over mix', state: by(at >= 0 && at <= 1, at >= 2) },
      { label: 'Frames (GPU)', state: by(at === 0, at >= 1) },
      { label: 'Encode', state: by(at === 0 || at === 2, at >= 3) },
      { label: 'Mux audio', state: by(at === 3, at >= 4) },
    );
  if (o.captions) out.push({ label: 'Captions', state: by(doc === 0, doc > 0) });
  if (o.doc) out.push({ label: 'Markdown doc', state: by(doc === 1 || doc === 2, doc > 2) });
  if (o.script) out.push({ label: 'Script', state: by(doc === 3, doc > 3) });
  return out;
}

/** What the stage shows at output time t, for the preview caption. */
function sceneLabel(tl: Timeline | null, t: number): string {
  if (!tl) return '';
  const pos = buildTimeMap(tl).toSource(t);
  if (!pos) return '';
  const scene = tl.scenes.find((s) => s.id === pos.sceneId);
  if (scene?.kind === 'explainer') return `Explainer · ${scene.component.replace(/^[a-z]+:/, '')}`;
  if (pos.kind !== 'recording') return '';
  const step = tl.steps.find((s) => s.take === pos.take && pos.takeTime >= s.from && pos.takeTime < s.to);
  return step ? `Recording · ${step.title}` : 'Recording';
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
const seconds = (s: number) =>
  s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;

/**
 * The Export screen: settings and outputs, then the export's progress with the frame being
 * rendered, sub-steps, Cancel, and Reveal in Finder. A cancelled export resumes from its
 * finished chunks when started again with the same settings.
 */
export function ExportScreen({ slug }: { slug: string }) {
  const { client } = useEngine();
  const tl = useTimeline(slug);
  const [settings, setSettings] = useState<ExportSettings>(() => ExportSettings.parse({}));
  const [job, setJob] = useState<ExportState | null>(null);
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [frame, setFrame] = useState<{ index: number; src: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The first rendering sample of this run and the latest one, for the speed and time left.
  const [pace, setPace] = useState<{ at: number; frames: number; now: number; own: number } | null>(null);

  const running = job?.state === 'running';

  useEffect(() => {
    if (!client) return;
    let live = true;
    void client.call('export.status', { slug }).then(
      (s) => {
        if (!live || !s) return;
        setJob(s);
        setSettings(s.settings);
      },
      () => {},
    );
    const offProgress = client.on('export.progress', (s) => {
      if (s.slug !== slug) return;
      setJob(s);
      if (s.state === 'running' && s.phase === 'render') {
        const at = performance.now();
        // Frames rendered by this run (reused ones from a resume don't count toward the speed).
        const own = s.frames - s.resumed;
        setPace((p) => (!p || own < p.frames ? { at, frames: own, now: at, own } : { ...p, now: at, own }));
      }
    });
    const offFrame = client.on('export.frame', (f) => {
      if (f.slug === slug) setFrame({ index: f.index, src: `data:image/jpeg;base64,${f.data}` });
    });
    return () => {
      live = false;
      offProgress();
      offFrame();
    };
  }, [client, slug]);

  // The plan (specs, resumable frames) for the chosen settings; refreshed when a job ends.
  const jobState = job?.state;
  useEffect(() => {
    if (!client || running) return;
    let live = true;
    void client.call('export.plan', { slug, settings }).then(
      (p) => live && setPlan(p),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [client, slug, settings, running, jobState, tl.version]);

  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const start = () => {
    setPace(null);
    setFrame(null);
    act(() => client!.call('export.start', { slug, settings }));
  };

  const chips = substeps(job, settings);
  const fps = job?.fps ?? settings.fps;
  const total = job?.total || plan?.frames || 0;
  const pct = Math.floor((job?.progress ?? 0) * 100);
  // Speed and time left from this run's own frames (reused ones came for free).
  const rate =
    running && pace && pace.own > pace.frames && pace.now > pace.at
      ? (pace.own - pace.frames) / ((pace.now - pace.at) / 1000)
      : null;
  const left = rate && job ? (job.total - job.frames) / rate : null;
  const status = useMemo(() => {
    if (!job)
      return plan?.resumable
        ? `A cancelled export can resume (${plan.resumable} frames done).`
        : 'Ready to export.';
    if (job.state === 'running') {
      if (job.phase === 'render')
        return rate
          ? `about ${seconds(left ?? 0)} left · GPU render running at ${(rate / fps).toFixed(1)}× real time`
          : job.resumed
            ? `resuming: ${job.resumed} frames reused`
            : 'starting the GPU renderers…';
      if (job.phase === 'docs') return `writing the ${job.detail ?? 'outputs'}…`;
      return `${job.phase === 'audio' ? 'mixing the voice-over' : job.phase === 'concat' ? 'joining the chunks' : 'adding the audio'}…`;
    }
    if (job.state === 'done') return `Exported in ${seconds(job.seconds ?? 0)}.`;
    if (job.state === 'cancelled')
      return plan?.resumable
        ? `Cancelled. Start again to resume (${plan.resumable} frames done).`
        : 'Cancelled.';
    return `Failed: ${job.error ?? 'unknown error'}`;
  }, [job, plan, rate, left, fps]);

  const outputs: { key: keyof ExportSettings['outputs']; name: string; file: string; disabled?: boolean }[] =
    [
      { key: 'video', name: 'Video', file: `${slug}.mp4 · overlays burned in` },
      { key: 'captions', name: 'Captions', file: 'captions.srt · captions.vtt' },
      { key: 'doc', name: 'Step-by-step doc', file: `tutorial.md · ${plan?.steps ?? 0} images` },
      {
        key: 'script',
        name: 'Playwright script',
        file:
          plan && !plan.hasScript ? 'no script.spec.ts in this project' : 'script.spec.ts · re-record later',
        disabled: plan ? !plan.hasScript : false,
      },
    ];
  const setOutput = (key: keyof ExportSettings['outputs'], v: boolean) =>
    setSettings((s) => ({ ...s, outputs: { ...s.outputs, [key]: v } }));
  const nothing = !Object.values(settings.outputs).some(Boolean);
  const shownIndex = frame?.index ?? null;

  return (
    <AppFrame current="studio" slug={slug}>
      <div className="export">
        <main className="export-main">
          <Title>Export</Title>
          <figure className="export-figure">
            <div className="export-preview">
              {frame ? (
                <img src={frame.src} alt={`Frame ${frame.index + 1} of the export`} />
              ) : (
                <span className="export-preview-empty">
                  {running ? 'Starting…' : 'The frame being rendered appears here.'}
                </span>
              )}
            </div>
            <figcaption className="export-caption ui-mono">
              <span>
                {shownIndex !== null
                  ? sceneLabel(tl.timeline, shownIndex / fps)
                  : `${tl.timeline ? formatDuration(buildTimeMap(tl.timeline).duration) : '—'} at ${fps} fps`}
              </span>
              <span>
                frame {(job?.frames ?? 0).toLocaleString()} / {total.toLocaleString()}
              </span>
            </figcaption>
          </figure>

          <section className="export-progress" aria-label="Progress">
            <div className="export-progress-head">
              <span className="export-pct">{pct}%</span>
              <span className="export-status" role="status">
                {status}
              </span>
            </div>
            <Progress value={job?.progress ?? 0} label="Export progress" />
            <ol className="export-chips">
              {chips.map((c) => (
                <li key={c.label} className="export-chip" data-state={c.state}>
                  {c.state === 'done' ? '✓' : c.state === 'active' ? '●' : '○'} {c.label}
                </li>
              ))}
            </ol>
            {error && (
              <span role="alert" className="export-error">
                {error}
              </span>
            )}
            {job?.state === 'done' && job.notes.length > 0 && (
              <ul className="export-notes">
                {job.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>
        </main>

        <aside className="export-side">
          <section className="export-settings" aria-label="Settings">
            <span className="export-h">Settings</span>
            <div className="export-field">
              <span className="export-label">Resolution</span>
              <Segmented
                label="Resolution"
                block
                disabled={running}
                options={RESOLUTIONS}
                value={settings.resolution}
                onChange={(resolution) => setSettings((s) => ({ ...s, resolution }))}
              />
            </div>
            <div className="export-field">
              <span className="export-label">Frame rate</span>
              <Segmented
                label="Frame rate"
                block
                disabled={running}
                options={RATES}
                value={String(settings.fps) as (typeof RATES)[number]}
                onChange={(v) => setSettings((s) => ({ ...s, fps: Number(v) as ExportSettings['fps'] }))}
              />
            </div>
            <fieldset className="export-outputs" disabled={running}>
              <legend className="export-label">Outputs</legend>
              {outputs.map((o) => (
                <label key={o.key} className="export-output" data-disabled={o.disabled || undefined}>
                  <span className="export-output-text">
                    <span className="export-output-name">{o.name}</span>
                    <span className="export-output-file">{o.file}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.outputs[o.key] && !o.disabled}
                    disabled={o.disabled}
                    onChange={(e) => setOutput(o.key, e.target.checked)}
                  />
                </label>
              ))}
            </fieldset>
            <MonoBox>
              {plan
                ? [
                    `H.264 · ${plan.encoder} · ${plan.bitrate / 1e6} Mbps`,
                    `${plan.width}×${plan.height} · ${settings.fps} fps · ${plan.frames.toLocaleString()} frames`,
                    `AAC 48 kHz · ${plan.voiced ? 'VO −16 LUFS' : 'no voice-over yet'}`,
                    `${formatDuration(plan.duration)} · ≤ ${mb(plan.maxBytes)}`,
                    `scenes: ${plan.scenes.recorded} recorded · ${plan.scenes.explainers} explainer${plan.scenes.explainers === 1 ? '' : 's'}`,
                  ].join('\n')
                : 'Loading…'}
            </MonoBox>
          </section>
          <div className="export-actions">
            {running ? (
              <Button
                className="export-action"
                onClick={() => act(() => client!.call('export.cancel', { slug }))}
              >
                Cancel
              </Button>
            ) : (
              <LinkButton className="export-action" href={`#/studio/${slug}`}>
                Back to Studio
              </LinkButton>
            )}
            {job?.state === 'done' && job.outputs.length > 0 ? (
              <>
                <Button className="export-action" onClick={start} disabled={nothing}>
                  Export again
                </Button>
                <Button
                  variant="primary"
                  className="export-action"
                  onClick={() => act(() => client!.call('project.reveal', { slug, path: job.outputs[0]! }))}
                >
                  Reveal in Finder
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                className="export-action"
                onClick={start}
                disabled={!client || running || nothing}
                title={nothing ? 'Choose at least one output' : undefined}
              >
                {plan?.resumable && !running ? 'Resume export' : 'Start export'}
              </Button>
            )}
          </div>
        </aside>
      </div>
    </AppFrame>
  );
}
