import { useEffect, useMemo, useState } from 'react';
import { buildTimeMap, ExportSettings, type ExportPlan, type ExportState, type Timeline } from '@studio/core';
import {
  Button,
  Glyph,
  IconTile,
  LinkButton,
  Segmented,
  Shell,
  ShellHeader,
  ShellPanel,
  StatusPill,
  StripeProgress,
  type GlyphName,
} from '@studio/ui';
import { useEngine } from '../../engine';
import { useTimeline } from '../../studio/useTimeline';
import { AppFrame, formatDuration } from '../frame';
import './export.css';

const QUALITIES = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
] as const;
const RATES = [
  { value: '24', label: '24 fps' },
  { value: '30', label: '30 fps' },
  { value: '60', label: '60 fps' },
] as const;

/** Each engine phase in the user's words (announced when it changes). */
const PHASE_LABEL: Record<ExportState['phase'], string> = {
  render: 'Rendering frames',
  audio: 'Adding the voice-over',
  concat: 'Encoding',
  mux: 'Adding the voice-over',
  docs: 'Writing captions and the doc',
  done: 'Finishing',
};

/** What the stage shows at output time t, for the preview caption. */
function sceneLabel(tl: Timeline | null, t: number): string {
  if (!tl) return '';
  const pos = buildTimeMap(tl).toSource(t);
  if (!pos) return '';
  const scene = tl.scenes.find((s) => s.id === pos.sceneId);
  if (scene?.kind === 'explainer') return `Explainer · ${scene.component.replace(/^[a-z]+:/, '')}`;
  if (pos.kind !== 'recording') return '';
  const step = tl.steps.find((s) => s.take === pos.take && pos.takeTime >= s.from && pos.takeTime < s.to);
  return step ? step.title : '';
}

const megabytes = (bytes: number) => `about ${Math.max(1, Math.round(bytes / 1e6))} MB`;
const timeLeft = (s: number) => (s < 60 ? 'less than a minute left' : `about ${Math.round(s / 60)} min left`);
const took = (s: number) =>
  s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;

/** One plain sentence for an export error; the raw text goes under Details. */
export function plainExportError(raw: string): string {
  const e = raw.toLowerCase();
  if (e.includes('choose at least one output')) return 'Choose at least one thing to export.';
  if (e.includes('timeline is empty')) return 'There is nothing to export yet: this tutorial has no video.';
  if (e.includes('already running')) return 'This tutorial is already exporting.';
  if (/webgpu|gpu|adapter/.test(e))
    return "Your Mac's graphics couldn't render the video. Restart the app and try again.";
  if (/ffmpeg|enoent/.test(e)) return "The video tools aren't installed. Check Settings → Get started.";
  if (/enospc|no space/.test(e)) return 'The disk is full. Free some space and export again.';
  return 'The export stopped because of an error. Try again, or open Details to see what went wrong.';
}

/** A finished file (or folder of pictures) for the done list. */
interface FileRow {
  label: string;
  sub: string;
  icon: GlyphName;
  path: string;
}

function fileRows(outputs: string[]): FileRow[] {
  const rows: FileRow[] = [];
  const folders = new Map<string, string[]>();
  for (const f of outputs) {
    const rel = f.replace(/^output\//, '');
    const slash = rel.indexOf('/');
    if (slash > 0) {
      const dir = rel.slice(0, slash);
      folders.set(dir, [...(folders.get(dir) ?? []), f]);
      continue;
    }
    const ext = rel.split('.').pop() ?? '';
    const [icon, sub]: [GlyphName, string] =
      ext === 'mp4'
        ? ['film', 'Video']
        : ext === 'srt' || ext === 'vtt'
          ? ['label', 'Captions']
          : rel === 'tutorial.md'
            ? ['box', 'Step-by-step doc']
            : rel.endsWith('.spec.ts')
              ? ['history', 'Recording script']
              : ['box', 'Notes for the recording script'];
    rows.push({ label: rel, sub, icon, path: f });
  }
  for (const [dir, files] of folders)
    rows.push({
      label: `${dir}/`,
      sub: `${files.length} picture${files.length === 1 ? '' : 's'} for the doc`,
      icon: 'folder',
      path: files[0]!,
    });
  return rows;
}

/** A folder path for display: the home folder as ~, with break points after each slash. */
function PathText({ path }: { path: string }) {
  const short = path.replace(/^\/Users\/[^/]+(?=\/)/, '~');
  const parts = short.split('/');
  return (
    <span className="xp-where-path ui-mono" title={path}>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </span>
      ))}
    </span>
  );
}

type Preview = 'running' | 'done' | 'error';

/** Dev-only fixtures (`#/export/<slug>?preview=running|done|error`): no export is started. */
function readPreview(): Preview | null {
  if (!import.meta.env.DEV) return null;
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('preview');
  return q === 'running' || q === 'done' || q === 'error' ? q : null;
}

function previewJob(kind: Preview, slug: string, settings: ExportSettings): ExportState {
  const base: ExportState = {
    slug,
    state: 'running',
    phase: 'render',
    detail: null,
    settings,
    fps: settings.fps,
    frames: 2522,
    total: 6005,
    resumed: 0,
    progress: 0.42,
    startedAt: new Date(0).toISOString(),
    seconds: null,
    file: null,
    error: null,
    outputs: [],
    notes: [],
  };
  if (kind === 'running') return base;
  if (kind === 'error')
    return {
      ...base,
      state: 'failed',
      progress: 0.18,
      error: 'render host: navigator.gpu.requestAdapter() returned null (WebGPU adapter not available)',
    };
  return {
    ...base,
    state: 'done',
    phase: 'done',
    frames: 6005,
    progress: 1,
    seconds: 212,
    file: `output/${slug}.mp4`,
    outputs: [
      `output/${slug}.mp4`,
      'output/captions.srt',
      'output/captions.vtt',
      'output/tutorial.md',
      ...Array.from({ length: 9 }, (_, i) => `output/stills/step-${i + 1}.png`),
      'output/script.spec.ts',
      'output/README.md',
    ],
    notes: ['Step 4 has no picture: its recording starts mid-click.'],
  };
}

/**
 * The Export screen: what you get, quality and where it's saved, then the export's progress
 * with the frame being rendered, and the finished files. A cancelled export resumes from its
 * finished chunks when started again with the same settings.
 */
export function ExportScreen({ slug }: { slug: string }) {
  const { client, state: conn } = useEngine();
  const tl = useTimeline(slug);
  const [preview] = useState(readPreview);
  const [settings, setSettings] = useState<ExportSettings>(() => ExportSettings.parse({}));
  const [job, setJob] = useState<ExportState | null>(() =>
    preview ? previewJob(preview, slug, ExportSettings.parse({})) : null,
  );
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [frame, setFrame] = useState<{ index: number; src: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  // The first rendering sample of this run and the latest one, for the speed and time left.
  const [pace, setPace] = useState<{ at: number; frames: number; now: number; own: number } | null>(null);

  const running = job?.state === 'running';

  useEffect(() => {
    if (!client || conn !== 'open') return;
    let live = true;
    void client.call('project.list', {}).then(
      (list) => live && setTitle(list.find((p) => p.slug === slug)?.title ?? null),
      () => {},
    );
    void client.call('settings.get', {}).then(
      (s) => live && setWorkspace(s.workspace),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, conn, slug]);

  useEffect(() => {
    if (!client || preview) return;
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
  }, [client, slug, preview]);

  // The plan (specs, size, folder, resumable frames) for the chosen settings; refreshed when a job ends.
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
    if (preview) return;
    setPace(null);
    setFrame(null);
    act(() => client!.call('export.start', { slug, settings }));
  };
  const reveal = (path: string) => act(() => client!.call('project.reveal', { slug, path }));

  const fps = job?.fps ?? settings.fps;
  const pct = Math.floor((job?.progress ?? 0) * 100);
  // Speed and time left from this run's own frames (reused ones came for free).
  const rate =
    running && pace && pace.own > pace.frames && pace.now > pace.at
      ? (pace.own - pace.frames) / ((pace.now - pace.at) / 1000)
      : null;
  const left = preview === 'running' ? 190 : rate && job ? (job.total - job.frames) / rate : null;
  const phase = job ? PHASE_LABEL[job.phase] : '';

  // The live region: only phase changes and the end of the job are announced.
  const announce = useMemo(() => {
    if (!job) return '';
    if (job.state === 'running') return `${phase}…`;
    if (job.state === 'done') return 'Export finished.';
    if (job.state === 'cancelled') return 'Export cancelled.';
    return `Export failed. ${plainExportError(job.error ?? '')}`;
  }, [job, phase]);

  const outputs: { key: keyof ExportSettings['outputs']; name: string; desc: string; disabled?: boolean }[] =
    [
      { key: 'video', name: 'Video', desc: 'MP4 with the voice-over and everything on screen' },
      { key: 'captions', name: 'Captions', desc: 'Subtitle files for YouTube or the docs site' },
      { key: 'doc', name: 'Step-by-step doc', desc: 'Markdown with one picture per step' },
      {
        key: 'script',
        name: 'Recording script',
        desc:
          plan && !plan.hasScript
            ? 'Not available: this tutorial has no recording script yet'
            : 'To record this tutorial again later',
        disabled: plan ? !plan.hasScript : false,
      },
    ];
  const setOutput = (key: keyof ExportSettings['outputs'], v: boolean) =>
    setSettings((s) => ({ ...s, outputs: { ...s.outputs, [key]: v } }));
  const chosen = outputs.filter((o) => settings.outputs[o.key] && !o.disabled);
  const nothing = chosen.length === 0;
  // Why Export is disabled, shown next to it (a tooltip on a disabled button never shows).
  const why = nothing
    ? 'Choose at least one thing to export.'
    : plan && plan.duration <= 0 && settings.outputs.video
      ? 'This tutorial has no video yet. Untick Video to export the rest.'
      : null;

  const folder =
    plan?.folder || (workspace ? `${workspace}/projects/${slug}/output` : `projects/${slug}/output`);
  // Older engines don't send `previous`.
  const previous = (plan?.previous as string[] | undefined) ?? [];
  const revealFolder = () => reveal(previous[0] ?? 'tutorial.json');
  const failed = job?.state === 'failed' ? (job.error ?? 'unknown error') : null;
  const name = title ?? slug;

  return (
    <AppFrame current="studio">
      <main className="xp">
        <div>
          <LinkButton variant="quiet" href={`#/studio/${slug}`}>
            <Glyph name="back" size={13} />
            Back to editing
          </LinkButton>
        </div>
        <h1 className="xp-title">Export {name}</h1>

        <div className="xp-grid">
          <Shell aria-label="Preview and progress">
            <ShellPanel className="xp-stage">
              {(frame || job?.state !== 'done') && (
                <figure className="xp-figure">
                  <div className="xp-frame">
                    {frame ? (
                      <img src={frame.src} alt={`Frame ${frame.index + 1} of the export`} />
                    ) : (
                      <span className="xp-frame-empty">
                        {running ? 'Starting…' : 'The video appears here while it exports.'}
                      </span>
                    )}
                  </div>
                  {running && frame && (
                    <figcaption className="xp-caption">
                      {sceneLabel(tl.timeline, frame.index / fps)}
                    </figcaption>
                  )}
                </figure>
              )}

              <p className="ui-sr-only" role="status" aria-live="polite">
                {announce}
              </p>

              {!running && job?.state !== 'done' && (
                <ul className="xp-pills" aria-label="Summary">
                  <li>
                    <StatusPill icon="clock">
                      {plan
                        ? formatDuration(plan.duration)
                        : tl.timeline
                          ? formatDuration(buildTimeMap(tl.timeline).duration)
                          : '—'}
                    </StatusPill>
                  </li>
                  <li>
                    <StatusPill>{QUALITIES.find((q) => q.value === settings.resolution)?.label}</StatusPill>
                  </li>
                  {plan && settings.outputs.video && (
                    <li>
                      <StatusPill>{megabytes(plan.maxBytes)}</StatusPill>
                    </li>
                  )}
                  {plan && (
                    <li>
                      {plan.voiced ? (
                        <StatusPill tone="positive" icon="check">
                          Narrated and captioned
                        </StatusPill>
                      ) : (
                        <StatusPill tone="warning" icon="warn">
                          No voice-over yet: the video will be silent
                        </StatusPill>
                      )}
                    </li>
                  )}
                </ul>
              )}

              {running && job && (
                <div className="xp-run">
                  <div className="xp-run-head">
                    <span className="xp-pct" aria-hidden="true">
                      {pct}%
                    </span>
                    <span className="xp-phase">
                      {phase}…{job.phase === 'render' && left !== null ? ` ${timeLeft(left)}` : ''}
                    </span>
                  </div>
                  <StripeProgress value={job.progress} label="Export progress" />
                  <p className="xp-muted">You can keep editing. You'll get a notification when it's done.</p>
                  <div>
                    <Button onClick={() => !preview && act(() => client!.call('export.cancel', { slug }))}>
                      Cancel export
                    </Button>
                  </div>
                </div>
              )}

              {job?.state === 'done' && (
                <div className="xp-done">
                  <div className="xp-done-head">
                    <IconTile icon="check" tone="positive" />
                    <div>
                      <h2 className="xp-h2">Exported</h2>
                      <p className="xp-muted">
                        Took {took(job.seconds ?? 0)}. Saved in <PathText path={folder} />
                      </p>
                    </div>
                  </div>
                  <ul className="xp-files">
                    {fileRows(job.outputs).map((f) => (
                      <li key={f.path} className="xp-file">
                        <IconTile icon={f.icon} />
                        <span className="xp-file-text">
                          <span className="xp-file-name ui-mono">{f.label}</span>
                          <span className="xp-muted">{f.sub}</span>
                        </span>
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-label={`Show ${f.label} in Finder`}
                          onClick={() => reveal(f.path)}
                        >
                          <Glyph name="folder" size={12} />
                          Show in Finder
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {job.notes.length > 0 && (
                    <ul className="xp-notes">
                      {job.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {job?.state === 'cancelled' && (
                <p className="xp-muted xp-pad">
                  Export cancelled.
                  {plan?.resumable
                    ? ` Export again to pick up where it stopped (${plan.resumable.toLocaleString()} frames done).`
                    : ''}
                </p>
              )}

              {(failed || error) && (
                <div className="xp-error" role="alert">
                  <Glyph name="warn" size={14} />
                  <div>
                    <p>{plainExportError(failed ?? error ?? '')}</p>
                    <details className="xp-details">
                      <summary>Details</summary>
                      <pre className="xp-raw">{failed ?? error}</pre>
                    </details>
                  </div>
                </div>
              )}
            </ShellPanel>
          </Shell>

          <Shell aria-labelledby="xp-get">
            <ShellHeader icon="upload" title={<span id="xp-get">What you get</span>} />
            <ShellPanel className="xp-side">
              <fieldset className="xp-outputs" disabled={running}>
                <legend className="ui-sr-only">Files to export</legend>
                {outputs.map((o) => (
                  <label key={o.key} className="xp-opt" data-disabled={o.disabled || undefined}>
                    <input
                      type="checkbox"
                      checked={settings.outputs[o.key] && !o.disabled}
                      disabled={o.disabled}
                      onChange={(e) => setOutput(o.key, e.target.checked)}
                    />
                    <span className="xp-opt-text">
                      <span className="xp-opt-name">{o.name}</span>
                      <span className="xp-muted">{o.desc}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="xp-field">
                <span className="xp-label" aria-hidden="true">
                  Quality
                </span>
                <Segmented
                  label="Quality"
                  block
                  disabled={running}
                  options={QUALITIES}
                  value={settings.resolution}
                  onChange={(resolution) => setSettings((s) => ({ ...s, resolution }))}
                />
              </div>

              <div className="xp-field">
                <span className="xp-label" aria-hidden="true">
                  Frame rate
                </span>
                <Segmented
                  label="Frame rate"
                  block
                  disabled={running}
                  options={RATES}
                  value={String(settings.fps) as (typeof RATES)[number]['value']}
                  onChange={(v) => setSettings((s) => ({ ...s, fps: Number(v) as ExportSettings['fps'] }))}
                />
              </div>

              <div className="xp-field">
                <span className="xp-label">Saves to</span>
                <div className="xp-where">
                  <Glyph name="folder" size={14} />
                  <PathText path={folder} />
                  <Button size="sm" onClick={revealFolder} disabled={!client}>
                    Show in Finder
                  </Button>
                </div>
                {previous.length > 0 && job?.state !== 'done' && (
                  <span className="xp-warn">
                    <Glyph name="warn" size={12} />
                    Replaces the previous export in that folder.
                  </span>
                )}
              </div>

              {!running && (
                <div className="xp-go">
                  <Button
                    variant="brand"
                    size="lg"
                    className="xp-go-btn"
                    onClick={start}
                    disabled={!client || why !== null}
                    aria-describedby={why ? 'xp-why' : undefined}
                  >
                    <Glyph name="upload" size={14} />
                    {plan?.resumable ? 'Resume export' : job?.state === 'done' ? 'Export again' : 'Export'}
                  </Button>
                  {why && (
                    <span className="xp-why" id="xp-why">
                      {why}
                    </span>
                  )}
                </div>
              )}

              <details className="xp-details">
                <summary>Details</summary>
                <div className="xp-details-body">
                  {plan ? (
                    <dl className="xp-specs">
                      <dt>Video</dt>
                      <dd>
                        H.264 ({plan.encoder}), {plan.bitrate / 1e6} Mbps, {plan.width}×{plan.height}
                      </dd>
                      <dt>Frames</dt>
                      <dd>
                        {plan.frames.toLocaleString()} at {settings.fps} fps
                        {running && job ? ` (${job.frames.toLocaleString()} done)` : ''}
                      </dd>
                      <dt>Audio</dt>
                      <dd>AAC 48 kHz{plan.voiced ? ', voice-over at −16 LUFS' : ', no voice-over'}</dd>
                      <dt>Scenes</dt>
                      <dd>
                        {plan.scenes.recorded} recorded, {plan.scenes.explainers} explainer
                        {plan.scenes.explainers === 1 ? '' : 's'}, {plan.steps} steps
                      </dd>
                      {rate !== null && (
                        <>
                          <dt>Speed</dt>
                          <dd>{(rate / fps).toFixed(1)}× real time</dd>
                        </>
                      )}
                      {job?.resumed ? (
                        <>
                          <dt>Resumed</dt>
                          <dd>{job.resumed.toLocaleString()} frames reused</dd>
                        </>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="xp-muted">Loading…</p>
                  )}
                </div>
              </details>
            </ShellPanel>
          </Shell>
        </div>
      </main>
    </AppFrame>
  );
}
