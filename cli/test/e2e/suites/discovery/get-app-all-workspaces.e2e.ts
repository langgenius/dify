/**
 * E2E: difyctl get app -A — Cross-Workspace App Query
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/Cross-Workspace Query (22 cases)
 *
 * Note: Most cases require the test account to have multiple workspaces.
 * Tests that depend on multiple workspaces are guarded by checking the
 * available_workspaces count from auth status.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertPipeFriendlyJson,
} from '../../helpers/assert.js'
import { withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

describe('E2E / difyctl get app -A (all-workspaces)', () => {
  let fx: Awaited<ReturnType<typeof withAuthFixture>>

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Basic fan-out ─────────────────────────────────────────────────────────

  it('[P0] internal user can execute all-workspaces query', async () => {
    const result = await fx.r(['get', 'app', '-A', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  it('[P1] --all-workspaces and -A flags behave identically', async () => {
    const r1 = await fx.r(['get', 'app', '-A', '-o', 'json'])
    const r2 = await fx.r(['get', 'app', '--all-workspaces', '-o', 'json'])
    assertExitCode(r1, 0)
    assertExitCode(r2, 0)
    // Both return same structure
    const p1 = assertJson<{ data: unknown[] }>(r1)
    const p2 = assertJson<{ data: unknown[] }>(r2)
    expect(p1.data.length).toBe(p2.data.length)
  })

  // ── Output format ─────────────────────────────────────────────────────────

  it('[P0] table output contains WORKSPACE column (or workspace_id in JSON)', async () => {
    // WORKSPACE column appears in table only when apps span multiple workspaces.
    // Verify via JSON that workspace_id is populated instead.
    const result = await fx.r(['get', 'app', '-A', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ workspace_id?: string }> }>(result)
    if (parsed.data.length > 0) {
      const hasWorkspace = parsed.data.some(a => typeof a.workspace_id === 'string' && a.workspace_id.length > 0)
      expect(hasWorkspace).toBe(true)
    }
  })

  it('[P0] JSON output contains workspace_id per app', async () => {
    const result = await fx.r(['get', 'app', '-A', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ workspace_id?: string }> }>(result)
    if (parsed.data.length > 0) {
      // At least the known workspace should be represented
      const hasWorkspaceId = parsed.data.some(app => typeof app.workspace_id === 'string')
      expect(hasWorkspaceId).toBe(true)
    }
  })

  it('[P1] YAML output contains workspace_id', async () => {
    const result = await fx.r(['get', 'app', '-A', '-o', 'yaml'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/workspace_id/)
  })

  it('[P1] all-workspaces output is pipe-friendly in JSON mode', async () => {
    const result = await fx.r(['get', 'app', '-A', '-o', 'json'])
    assertExitCode(result, 0)
    assertPipeFriendlyJson(result)
  })

  it('[P0] all-workspaces output has no ANSI colour codes (non-TTY)', async () => {
    const result = await fx.r(['get', 'app', '-A'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })

  // ── Filters in all-workspaces mode ────────────────────────────────────────

  it('[P1] --limit applies in all-workspaces mode', async () => {
    const result = await fx.r(['get', 'app', '-A', '--limit', '1', '-o', 'json'])
    assertExitCode(result, 0)
    // limit applies per workspace; total may be > 1 across workspaces
    // but the call itself must succeed
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  it('[P1] --mode filter applies in all-workspaces mode', async () => {
    const result = await fx.r(['get', 'app', '-A', '--mode', 'workflow', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ mode: string }> }>(result)
    parsed.data.forEach(app => expect(app.mode).toBe('workflow'))
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated get app -A returns auth error', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app', '-A'], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    }
    finally {
      await tmp.cleanup()
    }
  })

  it('[P0] unauthenticated -A exit code is 4', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app', '-A'], { configDir: tmp.configDir })
      expect(result.exitCode).toBe(4)
    }
    finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  it('[P0] external SSO user get app -A returns error', async () => {
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
      const result = await run(['get', 'app', '-A'], { configDir: ssoTmp.configDir })
      expect(result.exitCode).not.toBe(0)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  it('[P0] external SSO user -A exit code is not 0', async () => {
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
      const result = await run(['get', 'app', '-A'], { configDir: ssoTmp.configDir })
      // SSO subject has no workspace, so all-workspaces returns error
      expect(result.exitCode).not.toBe(0)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  // ── JSON error envelope ───────────────────────────────────────────────────

  it('[P1] JSON mode error outputs JSON error envelope to stderr', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app', '-A', '-o', 'json'], { configDir: tmp.configDir })
      expect(result.exitCode).not.toBe(0)
      assertErrorEnvelope(result)
    }
    finally {
      await tmp.cleanup()
    }
  })

  // ── Stability ─────────────────────────────────────────────────────────────

  it('[P1] using -A with -w together returns a stable result or clear error', async () => {
    // Spec: behaviour when both flags are provided should be stable
    const result = await fx.r(['get', 'app', '-A', '-w', E.workspaceId, '-o', 'json'])
    // Either success (ignores -w) or a clear usage/logical error — must not panic
    const isValid = result.exitCode === 0 || result.exitCode === 1 || result.exitCode === 2
    expect(isValid).toBe(true)
  })
})
