import type { E2ECapabilities } from '../setup/env.js'

declare module 'vitest' {
  export type ProvidedContext = {
    e2eCapabilities: E2ECapabilities
  }
}

export { }
