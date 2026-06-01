import type { E2ECapabilities } from '../setup/env.js'

// Augment vitest's ProvidedContext to add the e2eCapabilities key that
// global-setup injects via provideWorkerContext().
// Using interface merging (not re-declaring the type) to avoid TS2300
// duplicate identifier errors when vite-plus-test re-exports ProvidedContext.
declare module 'vitest' {
  type ProvidedContext = {
    e2eCapabilities: E2ECapabilities
  }
}

export { }
