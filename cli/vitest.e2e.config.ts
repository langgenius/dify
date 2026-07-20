import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { resolveBuildInfo } from './scripts/lib/resolve-buildinfo.js'

const buildInfo = resolveBuildInfo()

// Load .env.e2e into process.env (only if the file exists; in CI vars are
// injected directly via GitHub Actions secrets).
const envFilePath = resolve(process.cwd(), '.env.e2e')
try {
  const raw = readFileSync(envFilePath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch {
  // .env.e2e not found — rely on environment variables already set in the shell
}

/**
 * Vitest configuration for E2E tests.
 *
 * E2E tests run against a real staging Dify server and require
 * DIFY_E2E_* environment variables to be set (see test/e2e/setup/env.ts).
 *
 * Run: bun vitest --config vitest.e2e.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),
    },
  },
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist',
    target: 'node22',
    define: {
      __DIFYCTL_VERSION__: JSON.stringify(buildInfo.version),
      __DIFYCTL_COMMIT__: JSON.stringify(buildInfo.commit),
      __DIFYCTL_BUILD_DATE__: JSON.stringify(buildInfo.buildDate),
      __DIFYCTL_CHANNEL__: JSON.stringify(buildInfo.channel),
      __DIFYCTL_MIN_DIFY__: JSON.stringify(buildInfo.minDify),
      __DIFYCTL_MAX_DIFY__: JSON.stringify(buildInfo.maxDify),
    },
  },
  test: {
    environment: 'node',
    globalSetup: ['test/e2e/setup/global-setup.ts'],
    // E2E tests do NOT use the unit-test setup.ts (no globalThis stubs needed —
    // the real binary sets its own globals at startup).
    setupFiles: [],
    // DIFY_E2E_INCLUDE: comma-separated glob patterns, e.g.
    //   DIFY_E2E_INCLUDE="test/e2e/suites/run/run-app-basic.e2e.ts"
    //   DIFY_E2E_INCLUDE="test/e2e/suites/run/**/*.e2e.ts"
    //   DIFY_E2E_INCLUDE="test/e2e/suites/discovery/**/*.e2e.ts,test/e2e/suites/run/run-app-basic.e2e.ts"
    // Deprecated alias: DIFY_E2E_SINGLE_FILE (single path only, kept for back-compat)
    include:
      (() => {
        const raw = process.env.DIFY_E2E_INCLUDE ?? process.env.DIFY_E2E_SINGLE_FILE
        if (raw)
          return raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        return undefined
      })() ??
      (process.env.DIFY_E2E_MODE === 'local'
        ? ['test/e2e/suites/framework/help.e2e.ts', 'test/e2e/suites/agent/**/*.e2e.ts']
        : [
            // auth tests first (most others depend on a valid session)
            'test/e2e/suites/auth/login.e2e.ts',
            'test/e2e/suites/auth/status.e2e.ts',
            'test/e2e/suites/auth/use.e2e.ts',
            'test/e2e/suites/auth/whoami.e2e.ts',
            // help (no network, no auth — runs first)
            'test/e2e/suites/framework/help.e2e.ts',
            // output format (table / cross-cutting)
            'test/e2e/suites/output/**/*.e2e.ts',
            // error handling (cross-cutting error message spec)
            'test/e2e/suites/error-handling/**/*.e2e.ts',
            // framework (global flags, non-interactive, debug)
            'test/e2e/suites/framework/**/*.e2e.ts',
            // discovery (get app / describe app)
            'test/e2e/suites/discovery/**/*.e2e.ts',
            // dsl (export / import)
            'test/e2e/suites/dsl/**/*.e2e.ts',
            // run tests (require valid token)
            'test/e2e/suites/run/**/*.e2e.ts',
            'test/e2e/suites/agent/**/*.e2e.ts',
            // devices + logout LAST — both can revoke tokens
            'test/e2e/suites/auth/devices.e2e.ts',
            'test/e2e/suites/auth/logout.e2e.ts',
          ]),
    // E2E calls a real staging server — allow plenty of time per test.
    testTimeout: 120_000,
    hookTimeout: 30_000,
    // Retry up to 2 times on staging flakiness.
    // VITEST_RETRY env var lets CI opt-in to automatic retries for flaky server 500s.
    // Local default is 0 — per-test withRetry() handles known flaky paths more precisely.
    retry: Number(process.env.VITEST_RETRY ?? 0),
    // Run suites sequentially to avoid workspace-level conflicts on staging.
    pool: 'forks',
    fileParallelism: false,
    reporters: ['verbose'],
  },
})
