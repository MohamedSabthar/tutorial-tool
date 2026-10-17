import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';
import * as ReactDOM from 'react-dom';
import * as zod from 'zod';
import * as gsapModule from 'gsap';
import * as THREE from 'three';
import * as fiber from '@react-three/fiber';
import * as core from '@studio/core';
import * as stage from '@studio/stage';
import * as sdk from '@studio/overlay-sdk';
import * as overlaysCore from '@studio/overlays-core';
import * as scenesCore from '@studio/scenes-core';

/**
 * The engine compiles overlays in development mode (`jsxDEV` calls), but React's production
 * build exports `jsxDEV` as undefined: in the built app (served to the render host), fall back
 * to the production runtime.
 */
type Jsx = typeof jsxRuntime.jsx;
const devRuntime = {
  ...jsxDevRuntime,
  jsxDEV:
    (jsxDevRuntime as { jsxDEV?: unknown }).jsxDEV ??
    ((type: Parameters<Jsx>[0], props: Parameters<Jsx>[1], key?: Parameters<Jsx>[2], isStatic?: boolean) =>
      (isStatic ? jsxRuntime.jsxs : jsxRuntime.jsx)(type, props, key)),
};

/**
 * Overlays compiled by the engine read these instead of importing their own copies, so they
 * share the app's React (hooks work), three.js, GSAP (TextPlugin registered) and SDK.
 * Must match SHARED_MODULES in apps/engine/src/overlayServer.ts.
 */
export function registerSharedModules() {
  (globalThis as unknown as { __STUDIO_SHARED__: Record<string, unknown> }).__STUDIO_SHARED__ = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react/jsx-dev-runtime': devRuntime,
    'react-dom': ReactDOM,
    zod,
    gsap: gsapModule,
    three: THREE,
    '@react-three/fiber': fiber,
    '@studio/core': core,
    '@studio/stage': stage,
    '@studio/overlay-sdk': sdk,
    '@studio/overlays-core': overlaysCore,
    '@studio/scenes-core': scenesCore,
  };
}
