import { z } from 'zod';

export const ExportPhase = z.enum(['render', 'audio', 'concat', 'mux', 'docs', 'done']);

/** A project's export job, as the engine reports it (`export.progress`). */
export const ExportState = z.object({
  slug: z.string(),
  state: z.enum(['running', 'done', 'failed', 'cancelled']),
  phase: ExportPhase,
  fps: z.number(),
  /** Frames rendered so far, of `total`. */
  frames: z.number(),
  total: z.number(),
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
