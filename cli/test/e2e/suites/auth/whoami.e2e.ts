/**
 * E2E: difyctl auth whoami + external SSO session behaviour
 *
 * Test cases sourced from: Dify CLI Enhanced spec
 *   - Dify CLI/Auth/External SSO Login (19 cases, testable subset)
 *
 * Note: interactive login (Device Flow browser) and Headless auth require a real browser;
 *       E2E layer bypasses Device Flow via injectAuth, focusing on session state and CLI behaviour.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'
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
    await mkdir(configDir, { recursive: true, mode: 0o700 })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.token}`,
      `account:`,
      `  id: acct-e2e`,
      `  email: e2e-user@example.com`,
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

  async function withSSOAuth(issuer = 'https://idp.example.com') {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoe_sso_test_token`,
      `external_subject:`,
      `  email: sso-user@example.com`,
      `  issuer: ${issuer}`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

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
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/apps:run|SSO/i)
  })

  it('[P0] external SSO user auth status does not display workspace info', async () => {
    // Spec: auth status does not display workspace information
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    // SSO users have no workspace
    expect(result.stdout).not.toMatch(/^ {2}Workspace:/m)
  })

  it('[P0] external SSO user auth status displays issuer URL', async () => {
    // Spec: auth status displays External SSO Session + issuer URL
    await withSSOAuth('https://idp.enterprise.com')
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('idp.enterprise.com')
  })

  it('[P0] external user gets an error executing auth use (external SSO subjects have no workspaces)', async () => {
    // Spec: external user gets an error when executing auth use
    await withSSOAuth()
    const result = await r(['auth', 'use', 'any-ws-id'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/external SSO|workspace/i)
  })

  it('[P0] external user get workspace returns empty list or insufficient_scope', async () => {
    // Spec: external user get workspace returns an empty list
    await withSSOAuth()
    const result = await r(['get', 'workspace'])
    // SSO token has no workspace scope
    expect(result.exitCode).not.toBe(0)
  })

  it('[P0] external user get app returns insufficient_scope error', async () => {
    // Spec: external user get app returns insufficient_scope
    await withSSOAuth()
    const result = await r(['get', 'app'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/insufficient|scope|workspace|SSO/i)
  })

  it('[P0] external user whoami outputs SSO email', async () => {
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('sso-user@example.com')
  })

  const itWithSso = optionalIt(Boolean(E.ssoToken))

  itWithSso('[P0] external user can execute run app using SSO token', async () => {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.ssoToken}`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })

    const result = await r(['run', 'app', E.chatAppId, 'hello'])
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })
})
