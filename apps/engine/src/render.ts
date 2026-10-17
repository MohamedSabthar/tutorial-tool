import { RenderHost } from '@studio/exporters/node';
import { resolveUiUrl } from './ui';

/**
 * The engine's renderer for checks and review frames: the shared render host on the GPU, with
 * software rendering tolerated (export creates its own host that requires the GPU). The app is
 * loaded from the dev server when it runs, else from the engine itself.
 */
export class HeadlessStage extends RenderHost {
  constructor(engine: () => { port: number; token: string }) {
    super({ engine, uiUrl: () => resolveUiUrl(`http://127.0.0.1:${engine().port}`) });
  }
}
