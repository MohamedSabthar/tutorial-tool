import { z } from 'zod';

export const ExportPhase = z.enum(['render', 'audio', 'concat', 'mux', 'docs', 'done']);

export const EXPORT_RESOLUTIONS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
} as const;

/** What to export and how. */
export const ExportSettings = z.object({
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  resolution: z.enum(['720p', '1080p', '4k']).default('1080p'),
  outputs: z
    .object({
      video: z.boolean().default(true),
      captions: z.boolean().default(true),
      doc: z.boolean().default(true),
      script: z.boolean().default(true),
    })
    .default({ video: true, captions: true, doc: true, script: true }),
});
export type ExportSettings = z.infer<typeof ExportSettings>;

/** A project's export job, as the engine reports it (`export.progress`). */
export const ExportState = z.object({
  slug: z.string(),
  state: z.enum(['running', 'done', 'failed', 'cancelled']),
  phase: ExportPhase,
  /** What the current phase is doing (e.g. "stills" while writing the doc). */
  detail: z.string().nullable().default(null),
  settings: ExportSettings,
  fps: z.number(),
  /** Frames rendered so far, of `total` (including frames reused from a cancelled export). */
  frames: z.number(),
  total: z.number(),
  /** Frames reused from the last cancelled export of the same timeline and settings. */
  resumed: z.number().default(0),
  /** 0–1 over the whole export. */
  progress: z.number(),
  startedAt: z.string(),
  /** Seconds the export took (when done). */
  seconds: z.number().nullable(),
  /** The finished MP4, relative to the project folder (e.g. output/demo.mp4). */
  file: z.string().nullable(),
  error: z.string().nullable(),
  /** Every file written (relative to the project folder): the MP4, captions, doc, stills, script. */
  outputs: z.array(z.string()).default([]),
  /** Things worth knowing about the result (e.g. a step without a still). */
  notes: z.array(z.string()).default([]),
});
export type ExportState = z.infer<typeof ExportState>;

/** What an export with some settings will produce (the Export screen's specs box). */
export const ExportPlan = z.object({
  duration: z.number(),
  frames: z.number(),
  width: z.number(),
  height: z.number(),
  encoder: z.string(),
  /** Target video bitrate in bits per second. */
  bitrate: z.number(),
  /** Upper estimate of the MP4 size in bytes (the encoder usually stays under the target). */
  maxBytes: z.number(),
  scenes: z.object({ recorded: z.number(), explainers: z.number() }),
  steps: z.number(),
  voiced: z.boolean(),
  hasScript: z.boolean(),
  /** A cancelled export of the same timeline and settings that can be resumed (frames done). */
  resumable: z.number(),
});
export type ExportPlan = z.infer<typeof ExportPlan>;
