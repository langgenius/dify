/**
 * E2E: difyctl get app <id> — Single App Query
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/Single App Query (22 cases)
 *
 * Note: difyctl get app <id> calls GET /apps/<id>/describe?fields=info internally.
 * Server 1.14.1 returns HTTP 500 for all app IDs on this endpoint, so tests that
 * require a successful single-app lookup are deferred to a compatible server version.
 * The non-network tests (unauthenticated, not-found, error format) are covered here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
} from '../../helpers/assert.js'
import { withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()
const NONEXISTENT_ID = 'app-does-not-exist-e2e-xyz'

describe('E2E / difyctl get app <id> (single)', () => {
  let fx: Awaited<ReturnType<typeof withAuthFixture>>

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Not found ─────────────────────────────────────────────────────────────

  it('[P0] querying a non-existent app returns a non-zero exit code', async () => {
    const result = await fx.r(['get', 'app', NONEXISTENT_ID])
    expect(result.exitCode).not.toBe(0)
  })

  it('[P0] non-existent app exit code is 1', async () => {
    const result = await fx.r(['get', 'app', NONEXISTENT_ID])
    expect(result.exitCode).toBe(1)
  })

  it('[P1] JSON mode error for non-existent app outputs JSON error envelope', async () => {
    const result = await fx.r(['get', 'app', NONEXISTENT_ID, '-o', 'json'])
    expect(result.exitCode).not.toBe(0)
    assertErrorEnvelope(result)
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated get app <id> returns auth error (exit code 4)', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app', E.workflowAppId], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    }
    finally {
      await tmp.cleanup()
    }
  })

  it('[P0] unauthenticated exit code is 4', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app', E.workflowAppId], { configDir: tmp.configDir })
      expect(result.exitCode).toBe(4)
    }
    finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  it('[P0] external SSO user get app <id> returns a non-zero exit code', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { withTempConfig: wtc, run } = await import('../../helpers/cli.js')
    const ssoTmp = await wtc()
    try {
      await mkdir(ssoTmp.configDir, { recursive: true })
      const hostsYml = `${[
        `current_host: ${E.host}`,
        `token_storage: file`,
        `tokens:`,
        `  bearer: dfoe_sso_test_token`,
        `external_subject:`,
        `  email: sso@example.com`,
        `  issuer: https://issuer.example.com`,
      ].join('\n')}\n`
      await writeFile(join(ssoTmp.configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
      const result = await run(['get', 'app', E.workflowAppId], { configDir: ssoTmp.configDir })
      expect(result.exitCode).not.toBe(0)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })
})
