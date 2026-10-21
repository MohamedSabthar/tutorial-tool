import { afterEach, describe, expect, it } from 'vitest';
import { configureProducts, getProduct, listProducts, PRODUCTS } from '../src/products';

describe('product registry', () => {
  afterEach(() => configureProducts([]));

  it('keeps the built-in launch for entries without app or extensions (only the name changes)', () => {
    configureProducts([
      { id: 'wso2-integrator', name: 'Integrator', extension: 'wso2.wso2-integrator' } as never,
    ]);
    expect(getProduct('wso2-integrator')).toMatchObject({ type: 'vscode-app', name: 'Integrator' });
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

  it('goes back to the built-ins', () => {
    configureProducts([{ id: 'x', name: 'X', extensions: ['a.b'] }]);
    configureProducts([]);
    expect(listProducts()).toEqual(Object.values(PRODUCTS));
  });
});
