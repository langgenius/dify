import type { SuiteAPI, TestAPI } from 'vitest'
import type { DifyEdition, E2ECapabilities } from '../setup/env.js'
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

/**
 * Return an `it` variant that only runs in Enterprise Edition (EE) mode.
 *
 * Usage:
 *   const eeIt = enterpriseOnlyIt(caps)
 *   eeIt('[EE][P0] workspace switching works across two workspaces', async () => { … })
 *
 * In CE mode the test is automatically skipped with a clear label.
 * The [EE] tag in the test name is purely informational and documents the
 * requirement in the test report.
 */
export function enterpriseOnlyIt(caps: E2ECapabilities): TestAPI {
  return optionalIt(caps.edition === 'ee')
}

/**
 * Return a `describe` variant that only runs in Enterprise Edition (EE) mode.
 *
 * Usage:
 *   const eeDescribe = enterpriseOnlyDescribe(caps)
 *   eeDescribe('[EE] cross-workspace suite', () => { … })
 */
export function enterpriseOnlyDescribe(caps: E2ECapabilities): SuiteAPI {
  return optionalDescribe(caps.edition === 'ee')
}

/**
 * Convenience: return true when capabilities indicate Enterprise Edition.
 * Use for inline guards inside regular `it` blocks.
 *
 * @example
 *   it('cross-workspace query [EE]', async () => {
 *     if (!isEE(caps)) return   // skip silently in CE
 *     …
 *   })
 */
export function isEE(caps: { edition: DifyEdition }): boolean {
  return caps.edition === 'ee'
}
