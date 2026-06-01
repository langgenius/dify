import type { SuiteAPI, TestAPI } from 'vitest'
import { describe, it } from 'vitest'

// Explicit casts bridge the ChainableFunction vs SuiteAPI/TestAPI
// incompatibility introduced in vite-plus-test@0.1.22 (TS2322 / TS4058).
// Using 'unknown' as an intermediate to satisfy strict no-explicit-any rules.
export function optionalDescribe(condition: boolean): SuiteAPI {
  return (condition ? describe : describe.skip) as unknown as SuiteAPI
}

export function optionalIt(condition: boolean): TestAPI {
  return (condition ? it : it.skip) as unknown as TestAPI
}
