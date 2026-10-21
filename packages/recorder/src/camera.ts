import type { Frame, Page } from 'playwright';

/**
 * What's on camera besides the tutorial: notification toasts (hidden unless a step asks for
 * them), elements a product hides (`products.json` → `hide`), and things left open at the end of
 * a step (dialogs, quick picks, menus), which the run reports.
 */
const TOASTS_ID = 'studio-hide-toasts';
const TOASTS_CSS = '.notifications-toasts { visibility: hidden !important; }';

const hideCss = (selectors: string[]) =>
  selectors.length ? `${selectors.join(',\n')} { visibility: hidden !important; }` : '';

export interface Camera {
  /** Shows or hides notification toasts (hidden by default). */
  toasts(visible: boolean): Promise<void>;
  /** What's left open on screen right now, e.g. "dialog: Save changes?". */
  leftovers(): Promise<string[]>;
}

export async function prepareCamera(
  page: Page,
  hide: { workbench?: string[]; webview?: string[] } = {},
): Promise<Camera> {
  const workbench = hideCss(hide.workbench ?? []);
  if (workbench) await page.addStyleTag({ content: workbench });
  const webviewCss = hideCss(hide.webview ?? []);
  if (webviewCss) {
    const apply = (f: Frame) => {
      if (f !== page.mainFrame()) void f.addStyleTag({ content: webviewCss }).catch(() => {});
    };
    page.frames().forEach(apply);
    page.on('framenavigated', apply);
  }
  const toasts = async (visible: boolean) => {
    await page.evaluate(
      ({ id, css, visible }) => {
        document.getElementById(id)?.remove();
        if (visible) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
      },
      { id: TOASTS_ID, css: TOASTS_CSS, visible },
    );
  };
  await toasts(false);
  return {
    toasts,
    leftovers: () =>
      page
        .evaluate(() => {
          const shown = (el: Element | null): el is HTMLElement =>
            !!el &&
            el instanceof HTMLElement &&
            el.offsetParent !== null &&
            getComputedStyle(el).visibility !== 'hidden';
          const out: string[] = [];
          const dialog = document.querySelector('.monaco-dialog-box');
          if (shown(dialog)) out.push(`dialog: ${(dialog.textContent ?? '').trim().slice(0, 80)}`);
          if (shown(document.querySelector('.quick-input-widget'))) out.push('quick pick');
          if (shown(document.querySelector('.context-view .monaco-menu'))) out.push('menu');
          for (const t of document.querySelectorAll('.notifications-toasts .notification-toast'))
            if (shown(t)) out.push(`notification: ${(t.textContent ?? '').trim().slice(0, 80)}`);
          return out;
        })
        .catch(() => []),
  };
}
