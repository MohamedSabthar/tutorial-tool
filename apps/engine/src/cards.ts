import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTimeMap,
  type Project,
  type ProjectSummary,
  type PipelineState,
  type Timeline,
} from '@studio/core';
import { extractFrame } from './agent/tools/frames';

/**
 * Project cards for the Projects screen: duration from the timeline, and a poster frame of the
 * latest take (extracted once with ffmpeg into `.studio/`, served by the media route).
 */
export async function projectCard(
  project: Project,
  dir: string,
  timeline: Timeline | null,
  pipeline: PipelineState,
): Promise<ProjectSummary> {
  const take = timeline?.takes.at(-1) ?? null;
  // Projects recorded before scenes were derived from takes have an empty timeline: use the take.
  const duration = timeline && take ? buildTimeMap(timeline).duration || take.duration : null;
  let poster: string | null = null;
  if (take) {
    const rel = `.studio/poster-${take.id}.jpg`;
    const file = path.join(dir, rel);
    try {
      await access(file);
      poster = rel;
    } catch {
      try {
        const at = Math.min(Math.max(0, take.duration * 0.4), Math.max(0, take.duration - 0.1));
        const jpg = await extractFrame(path.join(dir, take.video), at);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, jpg);
        poster = rel;
      } catch {
        // No ffmpeg or an unreadable take: the card shows a plain thumbnail.
      }
    }
  }
  return {
    ...project,
    duration: duration && duration > 0 ? duration : null,
    poster: poster && `/media/${project.slug}/${poster}`,
    pipeline: { status: pipeline.status, stage: pipeline.stage },
  };
}
