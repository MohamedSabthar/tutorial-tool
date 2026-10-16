/**
 * Node-only entry point (`@studio/recorder/node`). Kept apart from the package index so the
 * desktop UI can import the package descriptor without pulling in Playwright.
 */
export * from './launch/vscode';
export * from './launch/vscodeSettings';
export * from './products';
export * from './check';
export * from './fixtures/biProject';
