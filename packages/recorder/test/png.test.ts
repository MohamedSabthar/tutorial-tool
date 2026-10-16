import { describe, expect, it } from 'vitest';
import { pngSize } from '../src/check';
import { vscodeUserSettings } from '../src/launch/vscodeSettings';
import { getProduct } from '../src/products';

describe('recorder helpers', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    const header = Buffer.alloc(24);
    header.writeUInt32BE(1920, 16);
    header.writeUInt32BE(1080, 20);
    expect(pngSize(header)).toEqual({ width: 1920, height: 1080 });
  });

  it('seeds settings that keep popups off camera', () => {
    expect(vscodeUserSettings['workbench.startupEditor']).toBe('none');
    expect(vscodeUserSettings['workbench.colorTheme']).toBe('Default Light Modern');
    expect(vscodeUserSettings['window.customTitleBarVisibility']).toBe('auto');
    expect(vscodeUserSettings['window.dialogStyle']).toBe('custom');
    expect(vscodeUserSettings['security.workspace.trust.enabled']).toBe(false);
  });

  it('knows the WSO2 Integrator products', () => {
    expect(getProduct('wso2-integrator').type).toBe('vscode-app');
    const ext = getProduct('wso2-integrator-vscode');
    expect(ext.type === 'vscode' && ext.extensions[0]).toMatch(/^WSO2\.wso2-integrator@/);
    expect(() => getProduct('nope')).toThrow(/unknown product/);
  });
});
