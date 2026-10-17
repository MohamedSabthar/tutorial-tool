import { chromium, type Browser, type Page } from 'playwright';
import { StageCapture } from './capture';

/**
 * The render host: the app's `#/render/<slug>` page in headless Chromium on the GPU, driven
 * frame by frame. Used by check_overlay/check_scene, run-review frames and export, so every
 * frame is drawn by the same stage code as the preview. The UI comes from Vite in development
 * (STUDIO_UI_URL, default http://localhost:1420) or from the built app served by the engine.
 */
export const GPU_ARGS = [
  '--use-angle=metal',
  '--enable-gpu',
  // WebGL runs on the GPU, but the page's own layers rasterize on the CPU: GPU raster dithers
  // gradients slightly differently from run to run (±1 on a pixel), and export must be repeatable.
  '--disable-gpu-rasterization',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];

/** Renderers that mean WebGL fell back to the CPU. */
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

/** Whether a WebGL renderer string means real GPU hardware. */
export const isHardwareRenderer = (renderer: string) => renderer !== 'no WebGL' && !SOFTWARE.test(renderer);

export class GpuUnavailableError extends Error {
  override name = 'GpuUnavailableError';
}

export interface RenderedFrame {
  t: number;
  png: Buffer;
  errors: Record<string, string>;
}

export interface RenderHostOptions {
  engine: () => { port: number; token: string };
  /** Where the app is served (resolved when a page opens), e.g. the Vite dev server or the engine. */
  uiUrl?: string | (() => Promise<string>);
  /** Refuse to render when WebGL is software-only (export); checks may allow it. */
  requireGpu?: boolean;
  /** Mount the stage in export mode (unscaled surface). */
  exportMode?: boolean;
}

export class RenderHost {
  private browser: Promise<Browser> | null = null;
  private pages = new Map<string, Promise<Page>>();
  private captures = new Map<string, Promise<StageCapture>>();
  private renderer: string | null = null;
  constructor(private opts: RenderHostOptions) {}

  private async ui(): Promise<string> {
    const u = this.opts.uiUrl;
    if (typeof u === 'function') return u();
    return u ?? process.env.STUDIO_UI_URL ?? 'http://localhost:1420';
  }

  /** The WebGL renderer string (e.g. "ANGLE Metal Renderer: Apple M1 Pro") and whether it is hardware. */
  async gpu(): Promise<{ renderer: string; hardware: boolean }> {
    if (!this.renderer) {
      const browser = await this.launch();
      const page = await browser.newPage();
      try {
        this.renderer = await page.evaluate(() => {
          const c = document.createElement('canvas');
          const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
          if (!gl) return 'no WebGL';
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        });
      } finally {
        await page.close();
      }
    }
    return { renderer: this.renderer, hardware: isHardwareRenderer(this.renderer) };
  }

  private launch(): Promise<Browser> {
    this.browser ??= chromium.launch({ args: GPU_ARGS });
    return this.browser;
  }

  private async page(slug: string): Promise<Page> {
    let p = this.pages.get(slug);
    if (!p) {
      p = (async () => {
        if (this.opts.requireGpu) {
          const g = await this.gpu();
          if (!g.hardware)
            throw new GpuUnavailableError(
              `Export needs the GPU, but Chromium is rendering in software (${g.renderer}).`,
            );
        }
        const browser = await this.launch();
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
        const { port, token } = this.opts.engine();
        const mode = this.opts.exportMode ? '&export=1' : '';
        const base = await this.ui();
        const url = `${base}/#/render/${slug}?engine=${port}&token=${encodeURIComponent(token)}${mode}`;
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
          await page.waitForFunction(() => window.__studioReady === true, null, { timeout: 30_000 });
        } catch (e) {
          await page.close().catch(() => {});
          throw new Error(
            `The render host could not open ${base}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
            { cause: e },
          );
        }
        return page;
      })();
      this.pages.set(slug, p);
      p.catch(() => this.pages.delete(slug));
    }
    return p;
  }

  /** PNG frames at output times; with `timeline`, renders that timeline instead of the saved one. */
  async render(slug: string, times: number[], timeline?: unknown): Promise<RenderedFrame[]> {
    const page = await this.page(slug);
    const out: RenderedFrame[] = [];
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

  /** One frame at output time `t`, captured over CDP (the export path: fast, clipped to the stage). */
  async frame(slug: string, t: number): Promise<RenderedFrame> {
    const page = await this.page(slug);
    let capture = this.captures.get(slug);
    if (!capture) {
      capture = StageCapture.open(page);
      this.captures.set(slug, capture);
      capture.catch(() => this.captures.delete(slug));
    }
    const { errors } = await page.evaluate((req) => window.__studioRender!(req), { t });
    return { t, png: await (await capture).png(), errors };
  }

  /** Drops a project's page (e.g. after its take changed). */
  async forget(slug: string) {
    const p = this.pages.get(slug);
    this.pages.delete(slug);
    const c = this.captures.get(slug);
    this.captures.delete(slug);
    await c?.then((x) => x.close()).catch(() => {});
    await p?.then((page) => page.close()).catch(() => {});
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    this.pages.clear();
    this.captures.clear();
    await b?.then((x) => x.close()).catch(() => {});
  }
}

declare global {
  interface Window {
    __studioReady?: boolean;
    __studioRender?: (req: { t: number; timeline?: unknown }) => Promise<{ errors: Record<string, string> }>;
  }
}
