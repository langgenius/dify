import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1)
      continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (key && !(key in process.env))
      process.env[key] = val
  }
}
catch {
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
    include: process.env.DIFY_E2E_MODE === 'local'
      ? ['test/e2e/suites/config/**/*.e2e.ts']
      : [
          // auth tests first (most others depend on a valid session)
          'test/e2e/suites/auth/status.e2e.ts',
          'test/e2e/suites/auth/use.e2e.ts',
          'test/e2e/suites/auth/whoami.e2e.ts',
          // config (local, no network)
          'test/e2e/suites/config/**/*.e2e.ts',
          // run tests (require valid token)
          'test/e2e/suites/run/**/*.e2e.ts',
          // devices + logout LAST — both can revoke tokens
          'test/e2e/suites/auth/devices.e2e.ts',
          'test/e2e/suites/auth/logout.e2e.ts',
        ],
    // E2E calls a real staging server — allow plenty of time per test.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Retry up to 2 times on staging flakiness.
    retry: 0, // flaky tests use withRetry() locally; global retry masks non-idempotent failures
    // Run suites sequentially to avoid workspace-level conflicts on staging.
    pool: 'forks',
    fileParallelism: false,
    reporters: ['verbose'],
  },
})
