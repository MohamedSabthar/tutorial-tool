/**
 * User settings seeded into every recording profile: a clean, consistent workbench with
 * nothing that pops up unexpectedly on camera.
 */
export const vscodeUserSettings: Record<string, unknown> = {
  'workbench.colorTheme': 'Default Light Modern',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.layoutControl.enabled': false,
  'window.titleBarStyle': 'custom',
  // Keep the in-window title bar in full screen so the product name stays on camera.
  'window.customTitleBarVisibility': 'auto',
  'window.title': '${rootName}${separator}${appName}',
  // Draw dialogs inside the window: visible on camera and clickable by Playwright.
  'window.dialogStyle': 'custom',
  'window.commandCenter': false,
  'window.restoreWindows': 'none',
  'window.zoomLevel': 0,
  'editor.fontSize': 14,
  'editor.minimap.enabled': false,
  'editor.accessibilitySupport': 'off',
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'update.showReleaseNotes': false,
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'extensions.ignoreRecommendations': true,
  'security.workspace.trust.enabled': false,
  'git.openRepositoryInParentFolders': 'never',
  'git.enabled': false,
  'chat.commandCenter.enabled': false,
  'chat.disableAIFeatures': true,
  'github.copilot.enable': { '*': false },
  'accessibility.signals.sounds.volume': 0,
};
