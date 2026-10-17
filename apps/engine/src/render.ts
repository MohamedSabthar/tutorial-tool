import { chromium, type Browser, type Page } from 'playwright';
import { RpcError } from '@studio/core';

/**
 * Renders composited frames (recording + overlays + camera) exactly as the preview does, by
 * driving the app's `#/render/<slug>` page in headless Chromium. One browser, one page per
 * project, kept warm between calls. The UI is served by Vite in development (STUDIO_UI_URL,
 * default http://localhost:1420); export (7.x) will serve the built UI from the engine.
 */
export class HeadlessStage {
  private browser: Promise<Browser> | null = null;
  private pages = new Map<string, Promise<Page>>();

  constructor(
    private engine: () => { port: number; token: string },
    private uiUrl: string = process.env.STUDIO_UI_URL ?? 'http://localhost:1420',
  ) {}

  private async page(slug: string): Promise<Page> {
    let p = this.pages.get(slug);
    if (!p) {
      p = (async () => {
        this.browser ??= chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
        const browser = await this.browser;
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
        const { port, token } = this.engine();
        const url = `${this.uiUrl}/#/render/${slug}?engine=${port}&token=${encodeURIComponent(token)}`;
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
          await page.waitForFunction(() => window.__studioReady === true, null, { timeout: 30_000 });
        } catch (e) {
          await page.close().catch(() => {});
          throw new RpcError(
            `The headless renderer could not open ${this.uiUrl} (is the app's dev server running?): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
            'internal',
          );
        }
        return page;
      })();
      this.pages.set(slug, p);
      p.catch(() => this.pages.delete(slug));
    }
    return p;
  }

  /**
   * PNG frames at output times `times`. With `timeline`, renders that timeline instead of the
   * project's saved one (e.g. with a test instance added).
   */
  async render(
    slug: string,
    times: number[],
    timeline?: unknown,
  ): Promise<{ t: number; png: Buffer; errors: Record<string, string> }[]> {
    const page = await this.page(slug);
    const out: { t: number; png: Buffer; errors: Record<string, string> }[] = [];
    for (const t of times) {
      const { errors } = await page.evaluate(
        (req) => window.__studioRender!(req),
        timeline === undefined ? { t } : { t, timeline },
      );
      const png = await page
        .locator('[data-stage-surface]')
        .screenshot({ type: 'png', animations: 'disabled' });
      out.push({ t, png, errors });
    }
    return out;
  }

  /** Drops a project's page (e.g. after its take changed). */
  async forget(slug: string) {
    const p = this.pages.get(slug);
    this.pages.delete(slug);
    await p?.then((page) => page.close()).catch(() => {});
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    this.pages.clear();
    await b?.then((x) => x.close()).catch(() => {});
  }
}

declare global {
  interface Window {
    __studioReady?: boolean;
    __studioRender?: (req: { t: number; timeline?: unknown }) => Promise<{ errors: Record<string, string> }>;
  }
}
