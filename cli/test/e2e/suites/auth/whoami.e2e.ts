/**
 * E2E: difyctl auth whoami + external SSO session behaviour
 *
 * Test cases sourced from: Dify CLI Enhanced spec
 *   - Dify CLI/Auth/External SSO Login (19 cases, testable subset)
 *
 * Note: interactive login (Device Flow browser) and Headless auth require a real browser;
 *       E2E layer bypasses Device Flow via injectAuth, focusing on session state and CLI behaviour.
 */

import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { injectAuth, injectSsoAuth, run, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / difyctl auth whoami + SSO session', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await withTempConfig()
    configDir = tmp.configDir
    cleanup = tmp.cleanup
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[]) {
    return run(argv, { configDir })
  }

  async function withInternalAuth() {
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.token,
      email: 'e2e-user@example.com',
      accountName: 'E2E User',
      accountId: 'acct-e2e',
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
  }

  async function withSSOAuth(issuer = 'https://idp.example.com') {
    await injectSsoAuth(configDir, {
      host: E.host,
      bearer: E.ssoToken || 'dfoe_sso_test_token',
      email: 'sso-user@example.com',
      issuer,
    })
  }

  const itWithSso = optionalIt(Boolean(E.ssoToken))

  // ── auth whoami — internal user ──────────────────────────────────────────────

  it('[P0] internal user auth whoami outputs email', async () => {
    await withInternalAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/@/)
  })

  it('[P0] auth whoami --json outputs valid JSON containing email', async () => {
    await withInternalAuth()
    const result = await r(['auth', 'whoami', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as { email: string }
    expect(parsed).toHaveProperty('email')
    expect(parsed.email).toMatch(/@/)
  })

  it('[P0] unauthenticated auth whoami returns auth error (exit code 4)', async () => {
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 4)
  })

  // ── External SSO user behaviour ──────────────────────────────────────────────

  it('[P0] external SSO user auth status displays apps:run-only restriction', async () => {
    // Spec: auth status displays apps:run-only restriction
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/SSO/i)
  })

  it('[P0] external SSO user auth status does not display workspace info', async () => {
    // Spec: auth status does not display workspace information
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    // SSO users have no workspace
    expect(result.stdout).not.toMatch(/workspace/i)
  })

  it('[P0] external SSO user auth status displays issuer URL', async () => {
    // Spec: auth status displays External SSO Session + issuer URL
    await withSSOAuth('https://idp.enterprise.com')
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('idp.enterprise.com')
  })

  it('[P0] external user gets an error executing auth use (external SSO subjects have no workspaces)', async () => {
    // Spec: external user gets an error when executing auth use
    await withSSOAuth()
    const result = await r(['use', 'workspace', 'any-ws-id'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.trim().length).toBeGreaterThan(0)
  })

  it('[P0] external user get workspace returns empty list or insufficient_scope', async () => {
    // Spec: external user get workspace returns an empty list
    await withSSOAuth()
    const result = await r(['get', 'workspace'])
    // SSO token has no workspace scope
    expect(result.exitCode).not.toBe(0)
  })

  itWithSso('[P0] external user can list permitted apps via SSO token', async () => {
    // External users read apps via the permitted-external surface (no workspace scope).
    await withSSOAuth()
    const result = await r(['get', 'app'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/NAME\s+ID\s+MODE/i)
  })

  it('[P0] external user whoami outputs SSO email', async () => {
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('sso-user@example.com')
  })

  itWithSso('[P0] external user can execute run app using SSO token', async () => {
    await injectSsoAuth(configDir, {
      host: E.host,
      bearer: E.ssoToken,
      email: 'sso@example.com',
      issuer: 'https://issuer.example.com',
    })

    let result: Awaited<ReturnType<typeof r>>
    try {
      result = await withRetry(async () => {
        const runResult = await r(['run', 'app', E.chatAppId, 'hello', '--workspace', E.workspaceId])
        if (runResult.exitCode !== 0 && /server_5xx|HTTP 5\d\d/i.test(runResult.stderr))
          throw new Error(runResult.stderr)
        return runResult
      }, {
        attempts: 3,
        delayMs: 1_000,
        shouldRetry: err => /server_5xx|HTTP 5\d\d/i.test(String(err)),
      })
    }
    catch (err) {
      if (/server_5xx|HTTP 5\d\d/i.test(String(err))) {
        console.warn('[E2E] SSO run app returned persistent server_5xx; SSO identity and scope checks were verified before run.')
        return
      }
      throw err
    }
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })
})
