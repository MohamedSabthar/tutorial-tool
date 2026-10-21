import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Products the recorder knows how to launch. Two kinds:
 * - `vscode-app`: an installed VS Code-based product (e.g. WSO2 Integrator.app) with its
 *   extensions built in. Launched from its own executable.
 * - `vscode`: the pinned VS Code build plus marketplace extensions.
 */
interface ProductBase {
  id: string;
  name: string;
  /** Activity-bar entry that proves the product UI loaded (matched against aria-label). */
  activityBarLabel: RegExp;
  /** The workspace skill with its page objects (defaults to the id). */
  skill?: string;
}

export interface VSCodeAppProduct extends ProductBase {
  type: 'vscode-app';
  /** The .app bundle. Override with STUDIO_WSO2_INTEGRATOR_APP. */
  appPath: string;
}

export interface VSCodeExtensionProduct extends ProductBase {
  type: 'vscode';
  /** Marketplace ids, optionally pinned with @version. */
  extensions: string[];
}

export type Product = VSCodeAppProduct | VSCodeExtensionProduct;

/** The products the studio ships with. */
export const PRODUCTS: Record<string, Product> = {
  'wso2-integrator': {
    id: 'wso2-integrator',
    name: 'WSO2 Integrator',
    type: 'vscode-app',
    appPath: process.env.STUDIO_WSO2_INTEGRATOR_APP ?? '/Applications/WSO2 Integrator.app',
    activityBarLabel: /WSO2 Integrator/i,
  },
  'wso2-integrator-vscode': {
    id: 'wso2-integrator-vscode',
    name: 'WSO2 Integrator (VS Code extension)',
    type: 'vscode',
    extensions: ['WSO2.wso2-integrator@1.0.1'],
    activityBarLabel: /WSO2 Integrator/i,
    skill: 'wso2-integrator',
  },
};

/** Built-in products merged with the workspace's products.json (see configureProducts). */
let registry: Record<string, Product> = { ...PRODUCTS };

/**
 * Applies the workspace's product entries: `app` launches an installed VS Code-based app,
 * `extensions` the pinned VS Code with those extensions; an entry with neither keeps the
 * built-in launch (only its name changes), and a new product without either is skipped.
 */
export function configureProducts(
  entries: { id: string; name: string; app?: string; extensions?: string[] }[],
): void {
  const next: Record<string, Product> = { ...PRODUCTS };
  for (const e of entries) {
    const base = PRODUCTS[e.id];
    const label = base?.activityBarLabel ?? new RegExp(e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const common = {
      id: e.id,
      name: e.name,
      activityBarLabel: label,
      ...(base?.skill ? { skill: base.skill } : {}),
    };
    if (e.app) next[e.id] = { ...common, type: 'vscode-app', appPath: e.app };
    else if (e.extensions?.length) next[e.id] = { ...common, type: 'vscode', extensions: e.extensions };
    else if (base) next[e.id] = { ...base, name: e.name };
  }
  registry = next;
}

export function listProducts(): Product[] {
  return Object.values(registry);
}

export function getProduct(id: string): Product {
  const p = registry[id];
  if (!p) throw new Error(`unknown product "${id}"`);
  return p;
}

export interface AppInfo {
  executable: string;
  name: string;
  version: string;
  commit: string | null;
}

/** Reads an installed VS Code-based app bundle (macOS) and finds its executable. */
export function readAppBundle(appPath: string): AppInfo {
  const productJson = path.join(appPath, 'Contents', 'Resources', 'app', 'product.json');
  if (!existsSync(productJson))
    throw new Error(`${appPath} is not an installed VS Code-based app (no product.json)`);
  const product = JSON.parse(readFileSync(productJson, 'utf8')) as {
    nameShort?: string;
    nameLong?: string;
    version?: string;
    commit?: string;
  };
  const name = product.nameShort ?? path.basename(appPath, '.app');
  const executable = path.join(appPath, 'Contents', 'MacOS', name);
  if (!existsSync(executable)) throw new Error(`no executable at ${executable}`);
  const pkg = JSON.parse(
    readFileSync(path.join(appPath, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'),
  ) as {
    version?: string;
  };
  return {
    executable,
    name,
    version: product.version ?? pkg.version ?? 'unknown',
    commit: product.commit ?? null,
  };
}
