import type { CDPSession, Page } from 'playwright';

/**
 * Captures the stage surface with CDP `Page.captureScreenshot`, clipped to the stage and
 * optimized for speed (lossless PNG with light compression). Faster than a locator screenshot,
 * which re-measures and scrolls on every call.
 */
export class StageCapture {
  private constructor(
    private cdp: CDPSession,
    private clip: { x: number; y: number; width: number; height: number },
  ) {}

  static async open(page: Page): Promise<StageCapture> {
    const box = await page.locator('[data-stage-surface]').boundingBox();
    if (!box) throw new Error('the render page has no stage surface');
    const cdp = await page.context().newCDPSession(page);
    return new StageCapture(cdp, {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
  }

  async png(): Promise<Buffer> {
    const { data } = (await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...this.clip, scale: 1 },
      optimizeForSpeed: true,
      captureBeyondViewport: false,
      fromSurface: true,
    })) as { data: string };
    return Buffer.from(data, 'base64');
  }

  async close() {
    await this.cdp.detach().catch(() => {});
  }
}
