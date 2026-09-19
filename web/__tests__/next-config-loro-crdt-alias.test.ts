import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Regression test for langgenius/dify#38532.
 *
 * The Dify web client bundles `loro-crdt` for the workflow collaboration
 * manager, which is transitively imported from the registration page
 * and other top-level layouts. `loro-crdt`'s default `browser` export
 * (and the `base64` subpath) both synchronously construct a
 * `WebAssembly.Module` on the main thread; on older Chromium-based
 * browsers that throws:
 *   "RangeError: WebAssembly.compile is disallowed on the main
 *    thread, if the buffer size is larger than 4KB"
 * because the bundled WASM blob is well over 4KB.
 *
 * The fix is a Turbopack `resolveAlias` that swaps `loro-crdt` for
 * `loro-crdt/bundler` in the browser bundle only. The `bundler` build
 * initializes the WASM asynchronously through `WebAssembly.instantiate`
 * (Promise-returning), which is allowed on the main thread on every
 * supported browser.
 *
 * This test pins both halves of the contract: (1) the Turbopack alias
 * exists in `next.config.ts`, and (2) the same alias exists in
 * `vite.config.ts` for the Vite-based pipelines (vitest, vinext) that
 * the rest of the test suite uses. If a future refactor moves the
 * alias or removes it, the test will fail and the regression will be
 * obvious in review.
 */
describe('loro-crdt browser bundle alias (#38532)', () => {
  const repoRoot = join(__dirname, '..', '..')

  const readConfig = (relativePath: string): string =>
    readFileSync(join(repoRoot, relativePath), 'utf8')

  it('next.config.ts aliases loro-crdt to loro-crdt/bundler for the browser condition', () => {
    const config = readConfig('web/next.config.ts')

    // The alias must be present under turbopack.resolveAlias.
    expect(config).toMatch(/turbopack:\s*\{/)
    expect(config).toMatch(/resolveAlias:/)

    // The exact mapping: 'loro-crdt' -> 'loro-crdt/bundler' under the
    // browser condition. Match the full key/value pair to make sure a
    // typo or a refactor back to 'loro-crdt/base64' (which still
    // synchronously constructs WebAssembly.Module) is caught.
    expect(config).toMatch(/loro-crdt'\s*:\s*\{\s*browser\s*:\s*'loro-crdt\/bundler'/)
    expect(config).toMatch(/resolveAlias:\s*\{/)

    // The server bundle is still kept external so SSR / API routes
    // keep using Node.js's `nodejs/index.js` entry (which is the
    // package's `node` condition).
    expect(config).toMatch(/serverExternalPackages:\s*\[\s*['"]loro-crdt['"]\s*\]/)
  })

  it('vite.config.ts continues to alias loro-crdt to loro-crdt/base64 for vitest / vinext', () => {
    // The Vite alias uses `base64` rather than `bundler` because the
    // vitest/vinext pipelines pre-resolve the WASM at build time and
    // `base64`'s inline blob is friendlier to the Vitest happy-dom
    // environment. The two pipelines target different bundlers, so
    // they need different aliases.
    const config = readConfig('web/vite.config.ts')
    expect(config).toMatch(/find:\s*\/\^loro-crdt\$\/.*replacement:\s*['"]loro-crdt\/base64['"]/s)
  })

  it('references issue #38532 in the comment block', () => {
    const config = readConfig('web/next.config.ts')
    // The fix must be linked to the issue so future maintainers can
    // find the context.
    expect(config).toMatch(/#38532|issues\/38532/)
  })
})
