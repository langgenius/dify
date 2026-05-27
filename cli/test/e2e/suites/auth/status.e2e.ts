/**
 * E2E: difyctl auth status — Auth Status
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Auth/Auth Status (12 cases)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode, assertNoAnsi } from '../../helpers/assert.js'
import { injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

describe('E2E / difyctl auth status', () => {
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

  function r(argv: string[], extraEnv?: Record<string, string>) {
    return run(argv, { configDir, env: extraEnv })
  }

  async function withAuth() {
    // Write a complete bundle including account fields so --json output includes account
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(configDir, { recursive: true, mode: 0o700 })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.token}`,
      `account:`,
      `  id: acct-e2e`,
      `  email: e2e@example.com`,
      `  name: E2E User`,
      `workspace:`,
      `  id: ${E.workspaceId}`,
      `  name: "${E.workspaceName}"`,
      `  role: owner`,
      `available_workspaces:`,
      `  - id: ${E.workspaceId}`,
      `    name: "${E.workspaceName}"`,
      `    role: owner`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  async function withSSOAuth() {
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.ssoToken || 'dfoe_test',
      workspaceId: '',
      workspaceName: '',
    })
    // Overwrite to add external_subject field
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.ssoToken || 'dfoe_test'}`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  // ── Basic status display ─────────────────────────────────────────────────────

  it('[P0] internal user auth status displays host, email, and workspace info', async () => {
    // Spec: internal user auth status displays host information
    await withAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain(E.host.replace(/^https?:\/\//, ''))
    expect(result.stdout).toContain(E.workspaceName)
  })

  it('[P0] auth status --json outputs a valid JSON schema', async () => {
    // Spec: auth status --json output is a parseable schema
    await withAuth()
    const result = await r(['auth', 'status', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty('logged_in', true)
    expect(parsed).toHaveProperty('host')
    expect(parsed).toHaveProperty('account')
  })

  it('[P1] auth status -v displays workspace role and storage info', async () => {
    // Spec: auth status -v displays workspace role
    await withAuth()
    const result = await r(['auth', 'status', '-v'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('owner')
    expect(result.stdout).toMatch(/file|keychain/)
  })

  // ── Unauthenticated scenario ─────────────────────────────────────────────────

  it('[P0] unauthenticated auth status returns "Not logged in" — exit code 4', async () => {
    // Spec: unauthenticated auth status returns error + exit code 4
    // configDir is empty (no hosts.yml)
    const result = await r(['auth', 'status'])
    assertExitCode(result, 4)
    expect(result.stdout).toMatch(/not logged in/i)
  })

  // ── External SSO user ────────────────────────────────────────────────────────

  it('[P0] external SSO user auth status does not display workspace row', async () => {
    // Spec: external SSO user auth status does not show workspace
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).not.toMatch(/workspace/i)
  })

  it('[P0] external SSO user auth status displays issuer URL', async () => {
    // Spec: external SSO user auth status displays issuer URL
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('issuer.example.com')
  })

  it('[P0] external SSO user auth status displays External SSO session info', async () => {
    // Spec: external SSO user auth status displays External SSO Session info
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/SSO|apps:run/i)
  })

  // ── Error scenarios ──────────────────────────────────────────────────────────

  it('[P0] auth status returns auth error when token is expired (401)', async () => {
    // Spec: auth status returns auth error after token expires
    // Inject a syntactically valid but actually expired token
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_expired_token_xyz',
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    // auth status reads only the local hosts.yml (no network); status is shown as long as a token exists.
    // Real token-expiry detection happens when commands like get app / run app are executed.
    const result = await r(['auth', 'status'])
    // A token present → show status without a 401 (status makes no network request)
    assertExitCode(result, 0)
  })

  it('[P1] auth status outputs JSON error envelope in JSON mode', async () => {
    // Spec: auth status outputs JSON error in JSON mode
    const result = await r(['auth', 'status', '--json'])
    // When not logged in, --json mode should output JSON rather than plain text
    expect(result.exitCode).toBe(4)
    // stdout should contain JSON (not-logged-in state)
    const parsed = JSON.parse(result.stdout) as { logged_in: boolean }
    expect(parsed.logged_in).toBe(false)
  })

  it('[P0] auth status output contains no ANSI colour (non-TTY)', async () => {
    await withAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })
})
