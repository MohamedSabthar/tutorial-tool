import { execFile } from 'node:child_process';
import path from 'node:path';
import {
  buildTimeMap,
  RpcError,
  type Annotation,
  type Rect,
  type RecorderEvent,
  type Timeline,
} from '@studio/core';
import { zoomMove } from '@studio/overlays-core';
import {
  cameraAt,
  fitSource,
  restCamera,
  sourceToStage,
  STAGE_SIZE,
  type CameraState,
  type Fit,
} from '@studio/stage';

const MAX_WIDTH = 1280;
/** Overlays and recorder actions this close to an annotation (seconds) are listed with it. */
const NEARBY = 4;

export interface ContextImage {
  /** Base64 JPEG. */
  data: string;
  mediaType: 'image/jpeg';
}

export interface AnnotationMessage {
  text: string;
  images: ContextImage[];
  ids: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const box = (r: Rect) =>
  `{x: ${Math.round(r.x)}, y: ${Math.round(r.y)}, w: ${Math.round(r.w)}, h: ${Math.round(r.h)}}`;

/** The camera at output time t, from the timeline's Zoom overlays (as the preview computes it). */
export function cameraAtTimeline(tl: Timeline, fit: Fit, t: number): CameraState {
  const stepBox = new Map(tl.steps.map((s) => [s.id, s.bbox]));
  const moves = tl.overlays
    .filter((o) => o.component === 'core:Zoom')
    .flatMap((o) => {
      const b = o.anchor ? stepBox.get(o.anchor.stepId) : undefined;
      const anchor = o.rect ?? (b ? sourceToStage(b, fit) : null);
      return anchor ? [zoomMove(o, anchor)] : [];
    });
  return cameraAt(t, moves, restCamera(STAGE_SIZE), fit.rect, STAGE_SIZE);
}

/** Screen rect (as seen at t) → stage px before the camera → take px. */
export function unproject(r: Rect, cam: CameraState, fit: Fit): { stage: Rect; source: Rect } {
  const stage = {
    x: (r.x - STAGE_SIZE.width / 2) / cam.zoom + cam.focusX,
    y: (r.y - STAGE_SIZE.height / 2) / cam.zoom + cam.focusY,
    w: r.w / cam.zoom,
    h: r.h / cam.zoom,
  };
  const source = {
    x: (stage.x - fit.rect.x) / fit.scale,
    y: (stage.y - fit.rect.y) / fit.scale,
    w: stage.w / fit.scale,
    h: stage.h / fit.scale,
  };
  return { stage, source };
}

const shapeRect = (a: Annotation): Rect =>
  a.shape.kind === 'rect'
    ? { x: a.shape.x, y: a.shape.y, w: a.shape.w, h: a.shape.h }
    : { x: a.shape.x, y: a.shape.y, w: 0, h: 0 };

/** A JPEG of the take at `seconds`, with `mark` outlined (take px); optionally cropped to `crop`. */
function frameJpeg(video: string, seconds: number, size: { w: number; h: number }, mark: Rect, crop?: Rect) {
  const filters: string[] = [];
  const m = {
    x: Math.round(mark.x),
    y: Math.round(mark.y),
    w: Math.max(2, Math.round(mark.w)),
    h: Math.max(2, Math.round(mark.h)),
  };
  if (mark.w < 4 && mark.h < 4) {
    // A pin: a ring of boxes around the point.
    filters.push(`drawbox=x=${m.x - 18}:y=${m.y - 18}:w=36:h=36:color=0xFF5800@0.95:t=5`);
  } else filters.push(`drawbox=x=${m.x}:y=${m.y}:w=${m.w}:h=${m.h}:color=0xFF5800@0.95:t=5`);
  if (crop) {
    // Clamped to the decoded frame, in case it differs from the take's recorded size.
    const w = Math.max(16, Math.floor(Math.min(crop.w, size.w)));
    const h = Math.max(16, Math.floor(Math.min(crop.h, size.h)));
    const cw = `min(${w}\\,iw)`;
    const ch = `min(${h}\\,ih)`;
    filters.push(
      `crop=w='${cw}':h='${ch}':x='min(${Math.max(0, Math.floor(crop.x))}\\,iw-${cw})':y='min(${Math.max(0, Math.floor(crop.y))}\\,ih-${ch})'`,
    );
  }
  filters.push(`scale='min(${MAX_WIDTH},iw)':-2`);
  const args = [
    '-v',
    'error',
    '-ss',
    String(Math.max(0, seconds)),
    '-i',
    video,
    '-frames:v',
    '1',
    '-vf',
    filters.join(','),
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    '-q:v',
    '4',
    '-',
  ];
  return new Promise<Buffer>((resolve, reject) =>
    execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr) || err.message));
      else resolve(stdout);
    }),
  );
}

/** A crop around the mark: the mark plus context, at least 640×360 take px, 16:9. */
function cropAround(mark: Rect, size: { w: number; h: number }): Rect {
  const w = Math.min(size.w, Math.max(640, mark.w * 2.2));
  const h = Math.min(size.h, Math.max(360, mark.h * 2.2, (w * 9) / 16));
  const cx = mark.x + mark.w / 2;
  const cy = mark.y + mark.h / 2;
  return {
    x: Math.min(Math.max(0, cx - w / 2), size.w - w),
    y: Math.min(Math.max(0, cy - h / 2), size.h - h),
    w,
    h,
  };
}

/**
 * One agent message for a batch of annotations: for each, the recorded frame with the marked
 * area outlined plus a close-up, the area in screen, stage and take pixels, the step and the
 * narration around it, nearby overlays and recorder actions, and the user's instruction.
 */
export async function annotationMessage(opts: {
  timeline: Timeline;
  projectDir: string;
  events: RecorderEvent[];
  ids?: string[];
}): Promise<AnnotationMessage> {
  const tl = opts.timeline;
  const picked = opts.ids?.length
    ? opts.ids.map((id) => {
        const a = tl.annotations.find((x) => x.id === id);
        if (!a) throw new RpcError(`no annotation "${id}"`, 'not_found');
        return a;
      })
    : tl.annotations.filter((a) => a.status === 'open');
  if (!picked.length) throw new RpcError('There are no open annotations to send.', 'bad_request');
  const empty = picked.filter((a) => !a.comment.trim());
  if (empty.length)
    throw new RpcError('Write what should change in every annotation before sending it.', 'bad_request');

  const tm = buildTimeMap(tl);
  const take = tl.takes.at(-1);
  const fit = take ? fitSource(take, STAGE_SIZE) : null;
  const images: ContextImage[] = [];
  const parts: string[] = [
    picked.length === 1
      ? 'The user left an annotation on the tutorial preview. Make the change it asks for.'
      : `The user left ${picked.length} annotations on the tutorial preview. Make the change each one asks for.`,
    [
      'Coordinates: the preview is 1920×1080 stage px. "On screen" is where the user pointed, as seen at that moment (after any camera zoom).',
      'Use "overlay rect" for an overlay\'s `rect` (stage px before the camera), or anchor to a step ({"anchor": {"stepId": …}}) when its target is the element. "Take px" matches step boxes and get_events.',
      'Change the tutorial only with apply_timeline_patch; look at the result with capture_frame. Finish with one or two sentences saying what you changed for each annotation number.',
    ].join(' '),
  ];

  for (const a of picked) {
    const n = tl.annotations.indexOf(a) + 1;
    const lines: string[] = [
      `## Annotation ${n} at t=${r2(a.t)} s (id ${a.id})`,
      `Instruction: ${a.comment.trim()}`,
    ];
    const pos = tm.toSource(a.t);
    const screen = shapeRect(a);
    if (pos?.kind === 'recording' && take && fit) {
      const cam = cameraAtTimeline(tl, fit, a.t);
      const { stage, source } = unproject(screen, cam, fit);
      const what = a.shape.kind === 'point' ? 'point' : 'region';
      lines.push(
        `Marked ${what}: on screen ${a.shape.kind === 'point' ? `(${Math.round(screen.x)}, ${Math.round(screen.y)})` : box(screen)}; overlay rect ${box(stage)}; take px ${box(source)}${cam.zoom > 1.01 ? ` (the camera is zoomed ${r2(cam.zoom)}× here)` : ''}.`,
        `Shown: ${take.id} at ${r2(pos.takeTime)} s of the recording, scene ${pos.sceneId}${(() => {
          const seg = tm.segments.find((s) => s.sceneId === pos.sceneId && s.index === pos.segment)?.segment;
          return seg?.kind === 'hold'
            ? ' (a freeze frame)'
            : seg?.kind === 'speed'
              ? ` (played at ${seg.rate}×)`
              : '';
        })()}.`,
      );
      // The step and the narration around it.
      const steps = tl.steps.map((s) => ({ s, start: tm.toOutput(s.take, s.from)[0] ?? Infinity }));
      const i = steps.findIndex((x, k) => a.t >= x.start && a.t < (steps[k + 1]?.start ?? tm.duration));
      const step = steps[i]?.s;
      if (step) {
        lines.push(
          `Step ${i + 1} "${step.title}" (${step.id}), from ${r1(steps[i]!.start)} s${step.bbox ? `; its primary target is take px ${box(step.bbox)}` : ''}.`,
          `Narration: ${step.narration.trim() ? `"${step.narration.trim()}"` : '(none yet)'}${steps[i - 1]?.s.narration ? `; before: "${steps[i - 1]!.s.narration.trim()}"` : ''}${steps[i + 1]?.s.narration ? `; after: "${steps[i + 1]!.s.narration.trim()}"` : ''}.`,
        );
      }
      // What the recorder did nearby: the named targets help find the element.
      const near = opts.events.filter(
        (e): e is Extract<RecorderEvent, { kind: 'click' | 'type' }> =>
          (e.kind === 'click' || e.kind === 'type') && Math.abs(e.t - pos.takeTime) <= NEARBY,
      );
      if (near.length)
        lines.push(
          'Recorder actions nearby (take time): ' +
            near
              .map(
                (e) =>
                  `${e.kind} "${e.target}"${e.kind === 'type' ? ` typing "${e.text}"` : ''} at ${r1(e.t)} s, box ${box(e.bbox)}`,
              )
              .join('; ') +
            '.',
        );
      const mark = a.shape.kind === 'point' ? { ...source, w: 0, h: 0 } : source;
      const video = path.join(opts.projectDir, take.video);
      const size = { w: take.width, h: take.height };
      const [full, crop] = await Promise.all([
        frameJpeg(video, pos.takeTime, size, mark),
        frameJpeg(video, pos.takeTime, size, mark, cropAround(mark, size)),
      ]);
      images.push(
        { data: full.toString('base64'), mediaType: 'image/jpeg' },
        { data: crop.toString('base64'), mediaType: 'image/jpeg' },
      );
      lines.push(
        `Images: the full frame with the mark outlined in orange, then a close-up (images ${images.length - 1} and ${images.length} of this message). They show the recording without overlays.`,
      );
    } else if (pos) {
      lines.push(
        `On screen ${box(screen)} at t=${r2(a.t)} s, inside explainer scene "${pos.sceneId}" (no recorded frame).`,
      );
    }
    const overlays = tl.overlays.filter(
      (o) => o.end >= a.t - NEARBY && o.start <= a.t + NEARBY && o.author !== 'auto',
    );
    const autos = tl.overlays.filter(
      (o) => o.end >= a.t - NEARBY && o.start <= a.t + NEARBY && o.author === 'auto',
    );
    if (overlays.length)
      lines.push(
        'Overlays nearby: ' +
          overlays
            .map(
              (o) =>
                `${o.id} ${o.component} ${r2(o.start)}–${r2(o.end)} s${o.anchor ? ` anchored to ${o.anchor.stepId}` : ''}${o.rect ? ` rect ${box(o.rect)}` : ''} props ${JSON.stringify(o.props)}`,
            )
            .join('; ') +
          '.',
      );
    if (autos.length)
      lines.push(
        `Automatic overlays here: ${[...new Set(autos.map((o) => o.component.slice(5)))].join(', ')} (rebuilt from the recording; edit them only if asked).`,
      );
    parts.push(lines.join('\n'));
  }
  return { text: parts.join('\n\n'), images, ids: picked.map((a) => a.id) };
}
