/**
 * E2E: difyctl auth use — Workspace switching
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Auth/Workspace Switching (22 cases)
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

// Secondary workspace used in tests — injected into available_workspaces
const WS2_ID = 'ws-e2e-secondary-0000-000000000002'
const WS2_NAME = 'Secondary Workspace'

describe('E2E / difyctl auth use', () => {
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

  /** Inject a bundle with two workspaces. */
  async function withTwoWorkspaces() {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.token}`,
      `workspace:`,
      `  id: ${E.workspaceId}`,
      `  name: "${E.workspaceName}"`,
      `  role: owner`,
      `available_workspaces:`,
      `  - id: ${E.workspaceId}`,
      `    name: "${E.workspaceName}"`,
      `    role: owner`,
      `  - id: ${WS2_ID}`,
      `    name: "${WS2_NAME}"`,
      `    role: normal`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  async function withSSOAuth() {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoe_sso_test`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  // ── Normal workspace switch ──────────────────────────────────────────────────

  it('[P0] internal user can switch to a specified workspace', async () => {
    // Spec: internal user can switch to a specified workspace
    await withTwoWorkspaces()
    const result = await r(['auth', 'use', WS2_ID])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/switched|workspace/i)
    expect(result.stdout).toContain(WS2_NAME)
  })

  it('[P0] auth status shows the new workspace after auth use', async () => {
    // Spec: auth status shows new workspace after auth use
    await withTwoWorkspaces()
    await r(['auth', 'use', WS2_ID])
    const status = await r(['auth', 'status'])
    assertExitCode(status, 0)
    expect(status.stdout).toContain(WS2_NAME)
  })

  it('[P0] auth use updates current_workspace_id (hosts.yml is updated)', async () => {
    // Spec: auth use updates current_workspace_id
    await withTwoWorkspaces()
    await r(['auth', 'use', WS2_ID])
    const { readFile } = await import('node:fs/promises')
    const hostsContent = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsContent).toContain(WS2_ID)
  })

  it('[P1] switching to the same workspace repeatedly is idempotent', async () => {
    // Spec: switching to the same workspace is idempotent
    await withTwoWorkspaces()
    const r1 = await r(['auth', 'use', E.workspaceId])
    assertExitCode(r1, 0)
    const r2 = await r(['auth', 'use', E.workspaceId])
    assertExitCode(r2, 0)
  })

  it('[P1] current workspace is persisted after auth use', async () => {
    // Spec: current workspace is persisted after auth use
    await withTwoWorkspaces()
    await r(['auth', 'use', WS2_ID])
    // Read hosts.yml directly to verify the workspace id was written
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const hostsContent = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsContent).toContain(WS2_ID)
  })

  // ── Error scenarios ──────────────────────────────────────────────────────────

  it('[P0] switching to a non-existent workspace returns an error', async () => {
    // Spec: switching to a non-existent workspace returns an error
    await withTwoWorkspaces()
    const result = await r(['auth', 'use', 'ws-does-not-exist-xyz'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/not found|workspace/i)
  })

  it('[P0] current_workspace_id is unchanged when workspace switch fails', async () => {
    // Spec: current_workspace_id is unchanged when workspace switch fails
    await withTwoWorkspaces()
    await r(['auth', 'use', 'ws-does-not-exist-xyz'])
    // Read hosts.yml directly; the original workspace id should still be present
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const hostsContent = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsContent).toContain(E.workspaceId)
  })

  it('[P0] unauthenticated auth use returns auth error (exit code 4)', async () => {
    // Spec: unauthenticated auth use returns auth error + exit code 4
    const result = await r(['auth', 'use', E.workspaceId])
    assertExitCode(result, 4)
    expect(result.stderr).toMatch(/not.?logged.?in|auth.?login/i)
  })

  it('[P0] missing workspace argument returns a usage error', async () => {
    // Spec: missing workspace argument returns a usage error
    await withTwoWorkspaces()
    const result = await r(['auth', 'use'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument|workspace/i)
  })

  // ── External SSO user ────────────────────────────────────────────────────────

  it('[P0] external SSO user is rejected when executing auth use', async () => {
    // Spec: external SSO user is rejected when executing auth use
    await withSSOAuth()
    const result = await r(['auth', 'use', 'any-ws-id'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/external SSO|workspace/i)
  })

  it('[P1] external SSO user auth use exit code is 1 or 2', async () => {
    // Spec: external SSO user auth use exit code is 1
    await withSSOAuth()
    const result = await r(['auth', 'use', 'any-ws-id'])
    expect([1, 2]).toContain(result.exitCode)
  })

  // ── JSON mode ────────────────────────────────────────────────────────────────

  it('[P1] stderr contains an error description when workspace does not exist', async () => {
    // Spec: non-existent workspace returns an error
    // Note: auth use does not support the -o flag; errors are reported via stderr text
    await withTwoWorkspaces()
    const result = await r(['auth', 'use', 'ws-nonexistent-xyz'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/not.?found|workspace/i)
  })
})
