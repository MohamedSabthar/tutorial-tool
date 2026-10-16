import { execFile } from 'node:child_process';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { buildTimeMap, type Rect } from '@studio/core';
import { fail, round, type ToolContext } from './context';

const MAX_WIDTH = 1280;

/** One JPEG frame of `video` at `seconds`, optionally cropped to `region` (video pixels). */
export function extractFrame(video: string, seconds: number, region?: Rect, size?: { w: number; h: number }) {
  const filters: string[] = [];
  if (region && size) {
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const w = Math.max(2, Math.min(Math.floor(region.w), size.w - x));
    const h = Math.max(2, Math.min(Math.floor(region.h), size.h - y));
    filters.push(`crop=${w}:${h}:${x}:${y}`);
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
      else if (!stdout.length) reject(new Error('no frame at that time'));
      else resolve(stdout);
    }),
  );
}

export function frameTools(ctx: ToolContext) {
  return [
    tool(
      'capture_frame',
      [
        'Look at the recording at output time t (seconds of the final video). Returns the recorded frame as an',
        'image, without overlays (overlay rendering comes with check_overlay). Pass region {x,y,w,h} in take',
        'pixels (as in step targets and get_events boxes) to zoom into part of the screen.',
      ].join(' '),
      {
        t: z.number().min(0),
        region: z
          .object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })
          .optional(),
      },
      async ({ t, region }) => {
        const { timeline } = await ctx.timelines.get(ctx.slug);
        const map = buildTimeMap(timeline);
        if (t > map.duration)
          return fail(`t=${t} is past the end of the tutorial (${round(map.duration)} s)`);
        const pos = map.toSource(t);
        if (!pos) return fail(`Nothing is shown at t=${t}`);
        if (pos.kind !== 'recording')
          return fail(`t=${t} is inside explainer scene "${pos.sceneId}"; it has no recorded frame`);
        const take = timeline.takes.find((k) => k.id === pos.take);
        if (!take) return fail(`Take "${pos.take}" is missing`);
        const jpeg = await extractFrame(
          path.join(ctx.store.dir(ctx.slug), take.video),
          pos.takeTime,
          region,
          { w: take.width, h: take.height },
        );
        return {
          content: [
            { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
            {
              type: 'text',
              text: `t=${t} → ${take.id} at ${round(pos.takeTime)} s (scene ${pos.sceneId})${
                region ? `, region ${JSON.stringify(region)}` : ''
              }; take is ${take.width}×${take.height}`,
            },
          ],
        };
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];
}
