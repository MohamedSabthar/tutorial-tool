import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTimeline, RecorderEvent, RpcError, withTake, type Take } from '@studio/core';
import {
  loadScript,
  probe,
  runTutorial,
  type LiveAction,
  type RunResult,
  type RunStage,
  type ScreencastFrame,
} from '@studio/recorder/node';
import type { ProjectStore } from './projects';
import type { Workspace } from './workspace';

export interface RecordCallbacks {
  signal?: AbortSignal;
  onStage?: (stage: RunStage) => void;
  onEvent?: (e: RecorderEvent) => void;
  onAction?: (a: LiveAction) => void;
  onFrame?: (f: ScreencastFrame) => void;
  onProgress?: (message: string) => void;
}

export interface ProjectRunResult extends RunResult {
  slug: string;
  takePath: string | null;
  codec: string | null;
}

/**
 * Runs a project's script.spec.ts. Record mode saves recordings/take-N (video.mp4,
 * events.jsonl, poster.jpg), registers the take in tutorial.json and commits.
 */
export async function runProjectScript(
  store: ProjectStore,
  workspace: Workspace,
  slug: string,
  mode: 'dry' | 'record',
  cb: RecordCallbacks = {},
): Promise<ProjectRunResult> {
  await workspace.ensure();
  const dir = store.dir(slug);
  const scriptFile = path.join(dir, 'script.spec.ts');
  const mod = await loadScript(scriptFile).catch((e: unknown) => {
    throw new RpcError(
      `could not load ${slug}/script.spec.ts: ${e instanceof Error ? e.message : String(e)}`,
      'bad_request',
    );
  });

  const takeId = mode === 'record' ? await store.nextTakeId(slug) : null;
  const takePath = takeId ? `recordings/${takeId}` : null;
  const result = await runTutorial(mod, {
    mode,
    ...(takePath ? { takeDir: path.join(dir, takePath), takeId: takeId! } : {}),
    captureTargets: false,
    ...cb,
  });

  let codec: string | null = null;
  if (result.take && takePath) {
    codec = (await probe(path.join(dir, takePath, 'video.mp4'))).codec;
    await registerTake(dir, result.take, takePath);
    await workspace.commit(`take: ${slug}/${takeId}`);
  }
  return { ...result, slug, takePath, codec };
}

/**
 * Registers the take in tutorial.json (paths relative to the project) and derives the
 * recording scene and steps from its events. Existing overlays are kept.
 */
export async function registerTake(dir: string, take: Take, takePath: string): Promise<void> {
  const file = path.join(dir, 'tutorial.json');
  const tl = parseTimeline(JSON.parse(await readFile(file, 'utf8')));
  const entry: Take = { ...take, video: `${takePath}/video.mp4`, events: `${takePath}/events.jsonl` };
  const events = (await readFile(path.join(dir, entry.events), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => RecorderEvent.parse(JSON.parse(l)));
  await writeFile(file, JSON.stringify(parseTimeline(withTake(tl, entry, events)), null, 2) + '\n');
}

/** Step start/end times (take seconds) from a run's events. */
export function stepTimings(events: RecorderEvent[]) {
  return events
    .filter((e): e is Extract<RecorderEvent, { kind: 'step-start' }> => e.kind === 'step-start')
    .map((s) => ({
      id: s.stepId,
      title: s.title,
      start: s.t,
      end: events.find((e) => e.kind === 'step-end' && e.stepId === s.stepId)?.t ?? null,
    }));
}
