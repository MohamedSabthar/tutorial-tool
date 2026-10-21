import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareCamera } from '../src/camera';

const PAGE = `<!doctype html><body>
  <div class="notifications-toasts"><div class="notification-toast">Update available</div></div>
  <div class="quick-input-widget">Pick a file</div>
  <button class="fab" aria-label="Open Copilot">AI</button>
</body>`;

describe('camera hygiene', () => {
  let browser: Browser;
  beforeAll(async () => void (browser = await chromium.launch()));
  afterAll(() => browser?.close());

  it('hides toasts and listed elements, shows toasts on request, and reports what is left open', async () => {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const cam = await prepareCamera(page, { workbench: ['.fab'] });
    const vis = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).visibility);
    expect(await vis('.notifications-toasts')).toBe('hidden');
    expect(await vis('.fab')).toBe('hidden');
    expect(await cam.leftovers()).toEqual(['quick pick']);
    await cam.toasts(true);
    expect(await vis('.notifications-toasts')).toBe('visible');
    expect(await cam.leftovers()).toEqual(['quick pick', 'notification: Update available']);
    await page.close();
  });
});
