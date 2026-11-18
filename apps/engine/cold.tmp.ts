import { RenderHost, diffFrames } from '@studio/exporters/node';
for (let i = 0; i < 60; i++) {
  try {
    await fetch('http://127.0.0.1:4317/health');
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
const host = new RenderHost({
  engine: () => ({ port: 4317, token: 'dev-token' }),
  uiUrl: 'http://127.0.0.1:4317',
  exportMode: true,
});
const [a, b] = await host.render('demo-http', [2.0, 2.0]);
console.log('cold vs warm same t', await diffFrames(a!.png, b!.png), a!.errors);
const f1 = await host.frame('demo-http', 3.0);
const f2 = await host.frame('demo-http', 3.0);
console.log('frame() repeat', await diffFrames(f1.png, f2.png));
await host.close();
