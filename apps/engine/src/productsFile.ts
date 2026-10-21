import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatIssues, ProductConfig, ProductsFile, RpcError, type ProductInfo } from '@studio/core';
import { configureProducts, listProducts, PRODUCTS } from '@studio/recorder/node';

/**
 * The workspace's `products.json`: which products tutorials can be made for, how the recorder
 * launches each and which skill holds its page objects. Read at start and after every save.
 */
export class ProductsRegistry {
  private entries: ProductConfig[] = [];

  constructor(private workspace: string) {}

  private get file() {
    return path.join(this.workspace, 'products.json');
  }

  /** Loads products.json into the recorder (a missing or invalid file leaves the built-ins). */
  async load(): Promise<void> {
    const text = await readFile(this.file, 'utf8').catch(() => null);
    const r = text === null ? null : ProductsFile.safeParse(JSON.parse(text));
    this.entries = r?.success ? r.data.products : [];
    configureProducts(this.entries);
  }

  list(): ProductInfo[] {
    return listProducts().map((p) => {
      const entry = this.entries.find((e) => e.id === p.id);
      return {
        id: p.id,
        name: p.name,
        launch: p.type === 'vscode-app' ? 'app' : 'vscode',
        app: p.type === 'vscode-app' ? p.appPath : null,
        extensions: p.type === 'vscode' ? p.extensions : [],
        skill: entry?.skill ?? p.skill ?? p.id,
        builtIn: p.id in PRODUCTS,
        available: p.type === 'vscode-app' ? existsSync(p.appPath) : true,
      };
    });
  }

  /** Replaces the entries (keeping fields the editor doesn't know, like projectStructure). */
  async save(products: ProductConfig[]): Promise<ProductInfo[]> {
    const ids = new Set<string>();
    for (const p of products) {
      const r = ProductConfig.safeParse(p);
      if (!r.success) throw new RpcError(`${p.id || 'a product'}: ${formatIssues(r.error)}`, 'bad_request');
      if (ids.has(p.id)) throw new RpcError(`two products have the id "${p.id}"`, 'bad_request');
      ids.add(p.id);
      if (!(p.id in PRODUCTS) && !p.app && !p.extensions?.length)
        throw new RpcError(`${p.name}: give an app path or at least one extension`, 'bad_request');
    }
    const text = await readFile(this.file, 'utf8').catch(() => null);
    const current = text === null ? null : ProductsFile.safeParse(JSON.parse(text));
    const rest = current?.success ? current.data : { products: [] };
    const merged = products.map((p) => {
      const old = rest.products.find((e) => e.id === p.id) ?? {};
      const next: Record<string, unknown> = { ...old, ...p };
      // A cleared field is removed, so the built-in launch applies again.
      if (!p.app) delete next.app;
      if (!p.extensions?.length) delete next.extensions;
      return next;
    });
    await writeFile(this.file, JSON.stringify({ ...rest, products: merged }, null, 2) + '\n');
    await this.load();
    return this.list();
  }
}
