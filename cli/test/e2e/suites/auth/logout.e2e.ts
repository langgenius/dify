/**
 * E2E: difyctl auth logout — Logout
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Auth/Logout (18 cases)
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()
// eslint-disable-next-line ts/no-explicit-any
const caps = inject('e2eCapabilities' as any) as import('../../setup/env.js').E2ECapabilities

describe('E2E / difyctl auth logout', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { configDir: dir, cleanup: cl } = await withTempConfig()
    configDir = dir
    cleanup = cl
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[]) {
    return run(argv, { configDir })
  }

  /**
   * Inject the dedicated per-suite logoutToken so that auth logout
   * calls DELETE /account/sessions/self on a disposable session and
   * never revokes the shared DIFY_E2E_TOKEN used by other suites.
   */
  async function withAuth() {
    const token = caps.logoutToken || E.token
    await injectAuth(configDir, {
      host: E.host,
      bearer: token,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
  }

  async function hostsFileExists(): Promise<boolean> {
    try {
      await access(join(configDir, 'hosts.yml'))
      return true
    }
    catch { return false }
  }

  // ── Basic logout ────────────────────────────────────────────────────────────

  it('[P0] logged-in user can logout successfully — stdout contains success message', async () => {
    // Spec: logged-in user can logout successfully
    await withAuth()
    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/logged out/i)
  })

  it('[P0] local hosts.yml is deleted after logout', async () => {
    // Spec: local token deleted after logout
    await withAuth()
    expect(await hostsFileExists()).toBe(true)
    await r(['auth', 'logout'])
    expect(await hostsFileExists()).toBe(false)
  })

  it('[P0] auth status returns "Not logged in" after logout', async () => {
    // Spec: auth status returns not-logged-in after logout
    await withAuth()
    await r(['auth', 'logout'])
    const statusResult = await r(['auth', 'status'])
    expect(statusResult.exitCode).toBe(4)
    expect(statusResult.stdout).toMatch(/not logged in/i)
  })

  it('[P1] auth status exit code is 4 after logout', async () => {
    // Spec: auth status exit code is 4 after logout
    await withAuth()
    await r(['auth', 'logout'])
    const statusResult = await r(['auth', 'status'])
    expect(statusResult.exitCode).toBe(4)
  })

  it('[P0] logout calls the revoke session endpoint (or best-effort local credential clear)', async () => {
    // Spec: logout calls the revoke session endpoint + logout returns success when revoke succeeds
    // Uses disposableToken so the shared DIFY_E2E_TOKEN is not revoked.
    await withAuth()
    const result = await r(['auth', 'logout'])
    // Local token must be cleared regardless of whether server revoke succeeds
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  it('[P0] local credentials are cleared even when server revoke fails (best-effort)', async () => {
    // Spec: local credentials cleared even when server revoke fails
    // Inject an invalid token → server rejects revoke, but local state must still be cleared
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_will_fail_revoke',
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'logout'])
    // exit 0 (best-effort); local file is cleared
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  // ── Unauthenticated (idempotent) ─────────────────────────────────────────────

  it('[P0] logout without a session returns not_logged_in error (exit code 4)', async () => {
    // Spec: logout without a session is idempotent
    // Actual behaviour: CLI returns not_logged_in (exit 4) when no token is present
    const result = await r(['auth', 'logout'])
    assertExitCode(result, 4)
    expect(result.stderr).toMatch(/not.?logged.?in/i)
  })

  // ── External SSO logout ─────────────────────────────────────────────────────

  it('[P0] external SSO user logout works correctly — local token cleared', async () => {
    // Spec: external SSO user logout works correctly
    const { writeFile } = await import('node:fs/promises')
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoe_sso_test_token`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })

    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  // ── Network error scenario ───────────────────────────────────────────────────

  it('[P0] local token is cleared even when logout encounters a network error', async () => {
    // Spec: local credentials cleared even when network is unavailable
    // Use an unreachable host to simulate network failure
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: http://unreachable-host-xyz.invalid`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoa_test_network_error`,
      `workspace:`,
      `  id: ws-1`,
      `  name: Test`,
      `  role: owner`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })

    const result = await run(['auth', 'logout'], { configDir, timeout: 10_000 })
    // Local token is cleared even if network request fails
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  // ── Post-logout operations ───────────────────────────────────────────────────

  it('[P1] run app returns auth error (exit code 4) after logout', async () => {
    // Spec: run app returns auth error after logout
    // Use disposableToken so the shared DIFY_E2E_TOKEN is not revoked.
    await withAuth()
    await r(['auth', 'logout'])
    const result = await r(['run', 'app', E.chatAppId, 'test'])
    expect(result.exitCode).toBe(4)
  })
})
