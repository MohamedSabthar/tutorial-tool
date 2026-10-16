# UI mockups

These are the design mockups for WSO2 Tutorial Studio. They are exported from the design canvas: https://claude.ai/artifact/AM773zNyDAmUxHwYQi7G9g

The light theme uses the WSO2 Slides design system. The layouts are adapted from `~/Desktop/UI`.

| File | Screen |
|---|---|
| `NewTutorial.dc.html` | 1 · Projects: "What should we teach today." |
| `Brief.dc.html` | 2 · Tutorial brief |
| `Live.dc.html` | 3 · Live: the agent records in VS Code |
| `Storyboard.dc.html` | 4 · Storyboard gate: steps and explainers |
| `Main.dc.html` | 5 · Studio: edit, annotate, ask the agent |
| `AgentFix.dc.html` | 6 · Agent fix review |
| `Export.dc.html` | 7 · Export |

`canvas.json` holds the board layout of the canvas.

The files are in Design Component format (`.dc.html`). They render inside the design canvas, which supplies `support.js`, so they don't open as standalone pages in a browser. Treat them as the reference for `packages/ui` and the screens in `apps/desktop`. See `docs/Implementation.md`, steps 0.5, 1.6, 2.7–2.8, 3.8, 5.4 and 7.6.

The images use the canvas's uploaded assets (`/_blob/...`). Local copies are in `assets/`:
- `/_blob/c76d22c4f2ee1f646b95e3ef749389bc` → `assets/mark-wso2-orange.png`
- `/_blob/00f77d8df1250af40937a5eb90ae0333` → `assets/logo-wso2-white-trim.png`
