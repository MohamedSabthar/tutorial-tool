import { afterEach, describe, expect, it } from 'vitest';
import { isUiPath, resolveUiUrl } from '../src/ui';

describe('served UI', () => {
  afterEach(() => {
    delete process.env.STUDIO_UI_URL;
  });

  it('exempts only the static app files from the token', () => {
    expect(isUiPath('/')).toBe(true);
    expect(isUiPath('/?x=1')).toBe(true);
    expect(isUiPath('/assets/index-abc.js')).toBe(true);
    expect(isUiPath('/rpc')).toBe(false);
    expect(isUiPath('/media/demo/recordings/take-1/video.mp4')).toBe(false);
    expect(isUiPath('/assetsx')).toBe(false);
  });

  it('prefers STUDIO_UI_URL', async () => {
    process.env.STUDIO_UI_URL = 'http://127.0.0.1:9999';
    expect(await resolveUiUrl('http://127.0.0.1:4000')).toBe('http://127.0.0.1:9999');
  });
});
