---
name: wso2-integrator
description: How to drive the WSO2 Integrator desktop app (VS Code fork with built-in WSO2 Integrator, MI, SI and Ballerina extensions) in Playwright tutorial scripts. Read before writing or repairing any script for product "wso2-integrator". Covers launching, required project structure, navigation, webview access, and page objects per component.
---

# WSO2 Integrator

- **Product:** `/Applications/WSO2 Integrator.app`, a VS Code fork. Last verified with version **1.127.0**, Ballerina **2201.14.1** (Swan Lake Update 14), extension `wso2.wso2-integrator` **1.2.0**.
- **How it's launched:** the recorder launches it for you (product id `wso2-integrator`) in a fresh profile: full screen, Light Modern theme, title bar showing "<folder> — WSO2 Integrator". Never launch it yourself in a script.

## Project structure (required)

WSO2 Integrator only recognises a folder as a project with a known structure. An empty folder triggers a blocking "couldn't detect the project type" dialog. Scripts declare a fixture, and the recorder creates it:

- **BI** (Ballerina integrations, the default): a root `Ballerina.toml` with `[workspace]` and `packages = [...]`, plus one folder per integration with its own `[package]` `Ballerina.toml` and the standard `.bal` files.
- **MI:** `pom.xml` containing `<projectType>integration-project</projectType>`. Not supported by the fixture builder yet.
- **SI:** `*.siddhi` files. Not supported yet.

```ts
export const fixture: ScriptFixture = {
  kind: 'bi', folder: 'greeting-project', title: 'Greeting Project',
  integrations: [{ name: 'greeting_service', title: 'Greeting Service' }],
};
```

On open, the WSO2 Integrator view is selected, and the integration overview ("Greeting Service · Integration", with the Copilot prompt and "Add Artifact manually") opens in an editor tab.

## Where things are

- **Main window (`page`):**
  - activity bar tabs: `page.getByRole('tab', { name: 'WSO2 Integrator' })`, `/^Explorer/`
  - the project tree: rows are `.monaco-list-row`, with text such as "Greeting Service", "Entry Points", "HTTP Service - /greeting"
  - title bar, notifications and quick picks
  - **Gotcha:** clicking the already-selected activity-bar tab collapses the side bar.
- **Visual editors (`webview()`):** everything inside the WSO2 Integrator editor tab is a VS Code webview. Always use `webview()` from the script context. Playwright resolves boxes in window coordinates automatically.
- **Diagram (flow) controls** have no accessible names. Use test ids: `empty-node-add-button-1` (the first "+" on an empty flow), `link-add-button-N`, `side-panel`, `ex-editor-expression`, `bi-diagram-canvas`, `start-node`.

## Components

| Component | Notes | Page objects |
|---|---|---|
| Integration overview and artifacts | Copilot prompt, "Add Artifact manually", the artifact catalogue | `pages/workbench.ts` |
| HTTP service | create the service, add resources, flow nodes (Return) | `pages/http-service.ts`, notes in `components/http-service.md` |

## Gotchas

- Text fields are web components. Use `getByRole('textbox', { name })`, not `getByLabel` (the label resolves to a wrapper `fill()` can't use).
- Some fields are prefilled (Service Base Path starts as "/"). Type with `{ clear: true }`.
- The expression editor opens a Helper Panel on focus that covers the side panel's Save button. Close it ("Close Helper Panel") before saving.
- "Try It" asks how to try the resource (a quick pick with Hurl or AI) and then needs a running service (a notification offers to run it). It isn't covered yet; leave it out of tutorials until it's verified.
