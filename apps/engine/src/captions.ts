import { buildTimeMap, cuesFromVoice, mergeCaptions, voiceSpans, type Timeline } from '@studio/core';

/**
 * Caption cues for the timeline's voice-over, in output time. Hand-edited cues are kept (and
 * generated cues overlapping them dropped). Runs after the voice-over or its timing changes.
 */
export function withCaptions(tl: Timeline): Timeline {
  const spans = voiceSpans(tl, buildTimeMap(tl));
  return { ...tl, captions: mergeCaptions(cuesFromVoice(spans), tl.captions) };
}
