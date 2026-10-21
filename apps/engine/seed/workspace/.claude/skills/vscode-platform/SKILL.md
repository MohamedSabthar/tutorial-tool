---
name: vscode-platform
description: Generic automation of VS Code-based products (WSO2 Integrator, VS Code with WSO2 extensions) in tutorial scripts - command palette, quick picks, explorer and tree views, editors, notifications, webviews, and avoiding native OS dialogs. Read when a script needs workbench UI that a product skill doesn't cover.
---

# VS Code workbench automation

The recorder launches the product in a fresh profile (full screen, Light Modern theme, custom
title bar, custom dialogs). Everything below is in `ctx.page` unless it says webview.

## Command palette and quick picks

```ts
await tut.press('Meta+Shift+P');
const input = page.locator('.quick-input-widget input');
await tut.type(input, 'Developer: Reload Window', { description: 'Command palette' });
await tut.press('Enter');
```

- Quick pick rows: `page.locator('.quick-input-list .monaco-list-row', { hasText: 'Hurl' })`.
- Wait for the widget (`tut.waitFor(input)`) before typing; it animates in.
- The palette is a good way to reach actions without hunting for buttons, but on screen it is
  less clear for viewers. Prefer visible buttons when the tutorial teaches where things are.

## Activity bar, side bar and trees

- Activity bar tabs: `page.getByRole('tab', { name: /^Explorer/ })`.
- Clicking the selected tab collapses the side bar. Check `aria-selected` first if unsure.
- Tree rows: `page.locator('.monaco-list-row', { hasText: 'src' }).first()`. Rows virtualise: scroll
  the tree (`row.scrollIntoViewIfNeeded()`) before clicking items far down.
- Twisties expand on click of the row; double-click opens files.

## Editors and tabs

- Tabs: `page.getByRole('tab', { name: 'main.bal' })`.
- Text editor content: click `page.locator('.monaco-editor .view-lines').first()` to focus, then
  `tut.type(..., { insert: true })`. Auto-closing brackets and quotes garble key-by-key typing.
- Save with `tut.press('Meta+S')`.

## Notifications

- Toasts: `page.locator('.notifications-toasts .notification-toast', { hasText: '…' })`. Their buttons
  are `getByRole('button', { name })` inside the toast.
- Close noise before a step that needs a clean screen: the toast's `Clear Notification` button.

## Webviews

- Extension UIs (WSO2 Integrator's visual editors) are webviews: `ctx.webview()` returns the
  active one's content frame. Locators inside it work like normal page locators.
- Boxes resolve in window coordinates automatically, so `tut.click` works the same.
- A newly opened editor tab replaces the active webview: re-query after navigation instead of
  keeping old locators.

## Native dialogs

- Native OS dialogs (file pickers, OS message boxes) never appear in the recording and block
  automation. The profile sets `window.dialogStyle: custom`, so VS Code's own dialogs are DOM
  (`.monaco-dialog-box`). Avoid flows that open OS file pickers: use the fixture instead.
