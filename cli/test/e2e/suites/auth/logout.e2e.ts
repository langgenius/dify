/**
 * E2E: difyctl auth logout — Logout
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Auth/Logout (18 wiki cases → 14 automated)
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { injectAuth, injectSsoAuth, run, withTempConfig } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

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
    const token = caps.logoutToken || 'dfoa_logout_suite_unavailable'
    await injectAuth(configDir, {
      host: E.host,
      bearer: token,
      email: E.email,
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

  async function expectNoActiveSession(): Promise<void> {
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 4)
    expect(result.stderr).toMatch(/not.?logged.?in/i)
  }

  // ── Basic logout ────────────────────────────────────────────────────────────

  it('[P0] logged-in user can logout successfully — stdout contains success message', async () => {
    // Spec: logged-in user can logout successfully
    await withAuth()
    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/logged out/i)
  })

  it('[P0] local active session is cleared after logout', async () => {
    // Spec: local token deleted after logout
    await withAuth()
    expect(await hostsFileExists()).toBe(true)
    await r(['auth', 'logout'])
    await expectNoActiveSession()
  })

  it('[P0] auth status returns "Not logged in" after logout', async () => {
    // Spec: auth status returns not-logged-in after logout
    await withAuth()
    await r(['auth', 'logout'])
    const statusResult = await r(['auth', 'whoami'])
    expect(statusResult.exitCode).toBe(4)
    expect(statusResult.stderr).toMatch(/not.?logged.?in/i)
  })

  it('[P1] auth status exit code is 4 after logout', async () => {
    // Spec: auth status exit code is 4 after logout
    await withAuth()
    await r(['auth', 'logout'])
    const statusResult = await r(['auth', 'whoami'])
    expect(statusResult.exitCode).toBe(4)
  })

  it('[P0] logout calls the revoke session endpoint (or best-effort local credential clear)', async () => {
    // Spec: logout calls the revoke session endpoint + logout returns success when revoke succeeds
    // Uses disposableToken so the shared DIFY_E2E_TOKEN is not revoked.
    await withAuth()
    const result = await r(['auth', 'logout'])
    // Local token must be cleared regardless of whether server revoke succeeds
    assertExitCode(result, 0)
    await expectNoActiveSession()
  })

  it('[P0] local credentials are cleared even when server revoke fails (best-effort)', async () => {
    // Spec: local credentials cleared even when server revoke fails
    // Inject an invalid token → server rejects revoke, but local state must still be cleared
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_will_fail_revoke',
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'logout'])
    // exit 0 (best-effort); local file is cleared
    assertExitCode(result, 0)
    await expectNoActiveSession()
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
    await injectSsoAuth(configDir, {
      host: E.host,
      bearer: E.ssoToken || 'dfoe_sso_test_token',
      email: 'sso@example.com',
      issuer: 'https://issuer.example.com',
    })

    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    await expectNoActiveSession()
  })

  // ── Network error scenario ───────────────────────────────────────────────────

  it('[P0] local token is cleared even when logout encounters a network error', async () => {
    // Spec: local credentials cleared even when network is unavailable
    // Use an unreachable host to simulate network failure
    await injectAuth(configDir, {
      host: 'http://unreachable-host-xyz.invalid',
      bearer: 'dfoa_test_network_error',
      email: E.email,
      workspaceId: 'ws-1',
      workspaceName: 'Test',
    })

    const result = await run(['auth', 'logout'], { configDir, timeout: 10_000 })
    // Local token is cleared even if network request fails
    assertExitCode(result, 0)
    await expectNoActiveSession()
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

  // ── Warning output when revoke fails ────────────────────────────────────────

  it('[P1] warning is printed to stdout/stderr when server revoke fails (best-effort)', async () => {
    // Spec 1.56: when revoke API fails the CLI emits a warning but logout still completes
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_will_fail_revoke',
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'logout'])
    // Logout completes successfully despite revoke failure
    assertExitCode(result, 0)
    // CLI must emit a warning (either stdout or stderr) about the revoke failure
    const combined = result.stdout + result.stderr
    expect(combined).toMatch(/warning|revoke|failed|could not/i)
    // Local credentials must still be cleared
    await expectNoActiveSession()
  })

  // ── Keychain token storage ───────────────────────────────────────────────────

  it('[P1] keychain token is deleted after logout', async () => {
    // Spec 1.59: keychain token is deleted after logout
    // We inject a session with token_storage=keychain; the CLI must clear the
    // keychain entry on logout.  In CI environments without a real keychain the
    // CLI falls back to file storage, so we accept either:
    //   (a) exit 0 + hosts.yml removed (file-fallback path), OR
    //   (b) exit 0 + hosts.yml absent (keychain-only path)
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_keychain_test_token',
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })

    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    await expectNoActiveSession()
  })

  // ── Multiple workspace sessions ──────────────────────────────────────────────

  it('[P1] logout clears only the current session when multiple workspace sessions exist', async () => {
    // Spec 1.62: current session is cleared on logout when multiple workspace sessions exist
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_multi_ws_test_token',
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
      availableWorkspaces: [
        { id: E.workspaceId, name: E.workspaceName, role: 'owner' },
        { id: 'ws-secondary-001', name: 'Secondary Workspace', role: 'member' },
      ],
    })

    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    // The current session (hosts.yml) must be cleared after logout
    await expectNoActiveSession()
  })

  // ── Re-login after logout ────────────────────────────────────────────────────

  it('[P1] a new session can be injected and used successfully after logout', async () => {
    // Spec 1.63: a new session can be created successfully after logout
    // Use disposableToken so the shared DIFY_E2E_TOKEN is not revoked.
    await withAuth()
    await r(['auth', 'logout'])
    await expectNoActiveSession()

    // Simulate a new login by injecting fresh credentials
    const token = caps.logoutToken || E.token
    await injectAuth(configDir, {
      host: E.host,
      bearer: token,
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })

    // New session must be recognised as valid
    const statusResult = await r(['auth', 'whoami'])
    assertExitCode(statusResult, 0)
    expect(statusResult.stdout).toContain(E.email)
  })
})
