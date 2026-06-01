import type { E2ECapabilities } from '../setup/env.js'

// Augment the ProvidedContext interface exported by vite-plus-test so that
// inject() and project.provide() are correctly typed for the e2eCapabilities
// key used throughout the E2E suite.
//
// We target '@voidzero-dev/vite-plus-test' (not 'vitest') because that is
// where ProvidedContext is actually defined as an empty interface designed
// for user augmentation.  Augmenting 'vitest' would cause TS2300 duplicate
// identifier errors in newer versions of vite-plus-test that re-export the
// same interface from their own module.
declare module '@voidzero-dev/vite-plus-test' {
  type ProvidedContext = {
    e2eCapabilities: E2ECapabilities
  }
}

export {}
