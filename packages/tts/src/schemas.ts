import { z } from 'zod';

/** Voice settings sent with every request (ElevenLabs `voice_settings`). */
export const VoiceSettings = z.object({
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0),
  speakerBoost: z.boolean().default(true),
  speed: z.number().min(0.7).max(1.2).default(1),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

/** Eleven v4: the most natural delivery, with character timings and neighbouring-line context. */
export const DEFAULT_MODEL = 'eleven_v4';

/** Models that take only stability and similarity (v4 has no style or speed controls). */
export const basicSettingsOnly = (modelId: string) => /^eleven_v4/.test(modelId);
export const DEFAULT_FORMAT = 'mp3_44100_128';

export const SynthesisRequest = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1),
  modelId: z.string().min(1).default(DEFAULT_MODEL),
  settings: VoiceSettings.default(VoiceSettings.parse({})),
  /** Neighbouring lines, so the intonation flows across line breaks (not part of the audio). */
  previousText: z.string().max(2000).optional(),
  nextText: z.string().max(2000).optional(),
});
export type SynthesisRequest = z.input<typeof SynthesisRequest>;

/** Per-character timings in seconds, aligned with `chars`. */
export const Alignment = z.object({
  chars: z.array(z.string()),
  starts: z.array(z.number()),
  ends: z.array(z.number()),
});
export type Alignment = z.infer<typeof Alignment>;

/** The `with-timestamps` response. */
export const TimestampsResponse = z.object({
  audio_base64: z.string(),
  alignment: z
    .object({
      characters: z.array(z.string()),
      character_start_times_seconds: z.array(z.number()),
      character_end_times_seconds: z.array(z.number()),
    })
    .nullable()
    .optional(),
  normalized_alignment: z
    .object({
      characters: z.array(z.string()),
      character_start_times_seconds: z.array(z.number()),
      character_end_times_seconds: z.array(z.number()),
    })
    .nullable()
    .optional(),
});

export const Voice = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  /** e.g. "american · young · narration". */
  description: z.string(),
  previewUrl: z.string().nullable(),
});
export type Voice = z.infer<typeof Voice>;

export const VoicesResponse = z.object({
  voices: z.array(
    z.object({
      voice_id: z.string(),
      name: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      labels: z.record(z.string(), z.string().nullable()).nullable().optional(),
      preview_url: z.string().nullable().optional(),
    }),
  ),
  has_more: z.boolean().optional(),
  next_page_token: z.string().nullable().optional(),
});
