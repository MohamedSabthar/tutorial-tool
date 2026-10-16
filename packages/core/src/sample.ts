import { parseTimeline, type Timeline } from './schemas';

/**
 * A small, valid timeline used by tests and the dev playground: two recording scenes
 * from one take, an explainer in between, and transitions on both sides.
 */
export function sampleTimeline(): Timeline {
  return parseTimeline({
    version: 1,
    takes: [
      {
        id: 'take-1',
        video: 'recordings/take-1/video.mp4',
        events: 'recordings/take-1/events.jsonl',
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 60,
      },
    ],
    scenes: [
      {
        id: 'sc-1',
        kind: 'recording',
        take: 'take-1',
        segments: [
          { kind: 'src', from: 0, to: 20 },
          { kind: 'hold', at: 20, duration: 2 },
          { kind: 'src', from: 20, to: 30 },
        ],
      },
      {
        id: 'sc-2',
        kind: 'explainer',
        component: 'project:RequestFlow',
        props: { path: '/greeting', port: 9090 },
        narration: ['A client sends a request to port 9090.', 'The listener matches /greeting.'],
        beats: [
          { id: 'b1', at: 'vo:0' },
          { id: 'b2', at: 'word:matches' },
        ],
        duration: 10,
      },
      {
        id: 'sc-3',
        kind: 'recording',
        take: 'take-1',
        segments: [
          { kind: 'src', from: 30, to: 40 },
          { kind: 'speed', from: 40, to: 60, rate: 2 },
        ],
      },
    ],
    transitions: [
      { id: 'tr-1', between: ['sc-1', 'sc-2'], component: 'core:FreezeMorph', duration: 1 },
      { id: 'tr-2', between: ['sc-2', 'sc-3'], component: 'core:ZoomThrough', duration: 1 },
    ],
    steps: [
      { id: 's1', title: 'Open the project', take: 'take-1', from: 0, to: 10 },
      { id: 's2', title: 'Add an HTTP entry point', take: 'take-1', from: 10, to: 30 },
      { id: 's3', title: 'Set the base path', take: 'take-1', from: 30, to: 45 },
    ],
    overlays: [
      { id: 'ov-1', component: 'core:TitleCard', start: 0, end: 3, props: { text: 'HTTP services' } },
      {
        id: 'ov-2',
        component: 'workspace:CodeCallout',
        start: 40,
        end: 45,
        anchor: { stepId: 's3' },
        props: { title: 'Service path' },
      },
    ],
  });
}
