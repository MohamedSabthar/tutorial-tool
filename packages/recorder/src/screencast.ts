import type { Page } from 'playwright';

/**
 * Streams the product window as JPEG frames over CDP (Page.startScreencast), for the Live
 * window. This is a preview stream, separate from the recorded video.
 */
export interface ScreencastFrame {
  /** Base64 JPEG. */
  data: string;
  /** Frame size in pixels (after maxWidth/maxHeight downscaling). */
  width: number;
  height: number;
  /** Capture time, seconds since the Unix epoch (from Chromium). */
  timestamp: number;
}

export interface ScreencastOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Send every Nth compositor frame (2 ≈ 30 fps on a 60 Hz display). */
  everyNthFrame?: number;
}

export async function startScreencast(
  page: Page,
  onFrame: (f: ScreencastFrame) => void,
  opts: ScreencastOptions = {},
): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  let stopped = false;
  cdp.on('Page.screencastFrame', (ev) => {
    // Ack first so Chromium keeps sending while we forward this one.
    void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    if (stopped) return;
    onFrame({
      data: ev.data,
      width: ev.metadata.deviceWidth * (ev.metadata.pageScaleFactor || 1),
      height: ev.metadata.deviceHeight * (ev.metadata.pageScaleFactor || 1),
      timestamp: ev.metadata.timestamp ?? Date.now() / 1000,
    });
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: opts.quality ?? 70,
    maxWidth: opts.maxWidth ?? 1600,
    maxHeight: opts.maxHeight ?? 1100,
    everyNthFrame: opts.everyNthFrame ?? 2,
  });
  return async () => {
    stopped = true;
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
  };
}
