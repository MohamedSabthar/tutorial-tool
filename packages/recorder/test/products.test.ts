import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appDisplayName, configureProducts, getProduct, listProducts, PRODUCTS } from '../src/products';
import { defaultFixture } from '../src/script';

describe('product registry', () => {
  afterEach(() => configureProducts([]));

  it('keeps the built-in launch for entries without app or extensions (only the name changes)', () => {
    configureProducts([{ id: 'wso2-integrator-vscode', name: 'Integrator' }]);
    expect(getProduct('wso2-integrator-vscode')).toMatchObject({ type: 'vscode', name: 'Integrator' });
  });

  it('names an app product as the installed app names itself', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'app-'));
    try {
      const app = path.join(dir, 'Renamed.app');
      mkdirSync(path.join(app, 'Contents', 'Resources', 'app'), { recursive: true });
      writeFileSync(
        path.join(app, 'Contents', 'Resources', 'app', 'product.json'),
        JSON.stringify({ nameLong: 'Choreo Integrator', nameShort: 'Integrator' }),
      );
      expect(appDisplayName(app)).toBe('Choreo Integrator');
      configureProducts([
        { id: 'wso2-integrator', name: 'WSO2 Integrator', app },
        { id: 'gone', name: 'Not installed', app: path.join(dir, 'Missing.app') },
      ]);
      expect(getProduct('wso2-integrator').name).toBe('Choreo Integrator');
      expect(getProduct('gone').name).toBe('Not installed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('launches an app or the pinned VS Code with extensions, and adds new products', () => {
    configureProducts([
      { id: 'wso2-integrator', name: 'WSO2 Integrator', app: '/Applications/Other.app' },
      { id: 'choreo-ext', name: 'Choreo', extensions: ['WSO2.choreo@2.0.0'] },
      { id: 'nothing', name: 'Skipped: no launch' },
    ]);
    expect(getProduct('wso2-integrator')).toMatchObject({
      type: 'vscode-app',
      appPath: '/Applications/Other.app',
    });
    expect(getProduct('choreo-ext')).toMatchObject({ type: 'vscode', extensions: ['WSO2.choreo@2.0.0'] });
    expect(getProduct('choreo-ext').activityBarLabel.test('Choreo')).toBe(true);
    expect(() => getProduct('nothing')).toThrow(/unknown product/);
    expect(listProducts().map((p) => p.id)).toEqual([
      'wso2-integrator',
      'wso2-integrator-vscode',
      'choreo-ext',
    ]);
  });

  it('starts Integrator products from a BI project and new products from an empty folder', () => {
    configureProducts([
      { id: 'wso2-integrator', name: 'WSO2 Integrator', app: '/Applications/Other.app' },
      { id: 'choreo-ext', name: 'Choreo', extensions: ['WSO2.choreo@2.0.0'] },
    ]);
    expect(defaultFixture('wso2-integrator').kind).toBe('bi');
    expect(defaultFixture('wso2-integrator-vscode').kind).toBe('bi');
    expect(defaultFixture('choreo-ext')).toEqual({ kind: 'empty', folder: 'tutorial', title: 'Tutorial' });
  });

  it('goes back to the built-ins', () => {
    configureProducts([{ id: 'x', name: 'X', extensions: ['a.b'] }]);
    configureProducts([]);
    expect(listProducts().map((p) => ({ ...p, name: '' }))).toEqual(
      Object.values(PRODUCTS).map((p) => ({ ...p, name: '' })),
    );
  });

  it('lets products.json say what a product starts from', () => {
    configureProducts([
      { id: 'agent-builder', name: 'Agent Builder', app: '/Applications/WSO2 Agent Builder.app' },
      { id: 'agent-builder-2', name: 'Agent Builder 2', app: '/Applications/X.app', fixture: 'bi' },
    ]);
    expect(defaultFixture('agent-builder').kind).toBe('empty');
    expect(defaultFixture('agent-builder-2').kind).toBe('bi');
  });
});
