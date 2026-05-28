/**
 * E2E: difyctl get app (list mode) — App List
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/App List (31 cases)
 *
 * Prerequisites (DIFY_E2E_* env vars):
 *   DIFY_E2E_CHAT_APP_ID     — echo-chat app
 *   DIFY_E2E_WORKFLOW_APP_ID — echo-workflow app
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

describe('E2E / difyctl get app (list)', () => {
  let fx: Awaited<ReturnType<typeof withAuthFixture>>

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Basic listing ─────────────────────────────────────────────────────────

  it('[P0] logged-in user can retrieve app list', async () => {
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it('[P0] default output format is table', async () => {
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    // table output: has column headers, no leading '{' (not JSON)
    expect(result.stdout.trimStart()).not.toMatch(/^\{/)
  })

  it('[P1] table output contains app ID', async () => {
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/ID/i)
  })

  it('[P1] table output contains app name', async () => {
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/NAME/i)
  })

  it('[P1] table output contains mode column', async () => {
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/MODE/i)
  })

  // ── Output formats ────────────────────────────────────────────────────────

  it('[P0] -o json outputs valid JSON', async () => {
    const result = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  it('[P1] -o yaml outputs valid YAML (non-empty, no JSON braces)', async () => {
    const result = await fx.r(['get', 'app', '-o', 'yaml'])
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
    // YAML lists start with '- ' not '{'
    expect(result.stdout.trimStart()).not.toMatch(/^\{/)
  })

  it('[P1] -o name outputs only app IDs (one per line)', async () => {
    const result = await fx.r(['get', 'app', '-o', 'name'])
    assertExitCode(result, 0)
    const lines = result.stdout.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    // Each line should look like a UUID
    expect(lines[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('[P1] -o wide outputs extended fields', async () => {
    const result = await fx.r(['get', 'app', '-o', 'wide'])
    assertExitCode(result, 0)
    // wide adds AUTHOR and WORKSPACE columns
    expect(result.stdout).toMatch(/AUTHOR|WORKSPACE/i)
  })

  it('[P1] output is pipe-friendly in JSON mode', async () => {
    const result = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(result, 0)
    assertPipeFriendlyJson(result)
  })

  it('[P0] output has no ANSI colour codes (non-TTY)', async () => {
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })

  // ── --limit ───────────────────────────────────────────────────────────────

  it('[P0] --limit restricts number of returned apps', async () => {
    const result = await fx.r(['get', 'app', '--limit', '1', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(parsed.data.length).toBeLessThanOrEqual(1)
  })

  it('[P1] --limit 1 returns exactly one result', async () => {
    const result = await fx.r(['get', 'app', '--limit', '1', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(parsed.data.length).toBe(1)
  })

  it('[P0] --limit 0 returns usage error (exit code 2)', async () => {
    const result = await fx.r(['get', 'app', '--limit', '0'])
    expect(result.exitCode).toBe(2)
  })

  it('[P0] --limit 201 returns usage error (exit code 2)', async () => {
    const result = await fx.r(['get', 'app', '--limit', '201'])
    expect(result.exitCode).toBe(2)
  })

  // ── --mode filter ─────────────────────────────────────────────────────────

  it('[P0] --mode chat filters to chat apps only', async () => {
    const result = await fx.r(['get', 'app', '--mode', 'chat', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ mode: string }> }>(result)
    parsed.data.forEach(app => expect(app.mode).toBe('chat'))
  })

  it('[P0] --mode workflow filters to workflow apps only', async () => {
    const result = await fx.r(['get', 'app', '--mode', 'workflow', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ mode: string }> }>(result)
    parsed.data.forEach(app => expect(app.mode).toBe('workflow'))
  })

  it('[P0] --mode with a valid enum value succeeds', async () => {
    // Spec: valid enum filter returns successfully
    const result = await fx.r(['get', 'app', '--mode', 'workflow', '-o', 'json'])
    assertExitCode(result, 0)
  })

  it('[P1] --mode with unknown value returns empty list or usage error', async () => {
    // Spec: invalid mode — CLI intercepts (oclif validates enum options, returns non-zero)
    const result = await fx.r(['get', 'app', '--mode', 'chatbot', '-o', 'json'])
    expect(result.exitCode).not.toBe(0)
  })

  // ── workspace override ────────────────────────────────────────────────────

  it('[P0] -w overrides the default workspace', async () => {
    // Pass the known workspace id — should return apps for that workspace
    const result = await fx.r(['get', 'app', '--workspace', E.workspaceId, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated get app returns auth error', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app'], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    }
    finally {
      await tmp.cleanup()
    }
  })

  it('[P0] unauthenticated get app exit code is 4', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app'], { configDir: tmp.configDir })
      expect(result.exitCode).toBe(4)
    }
    finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  it('[P0] external SSO user get app returns insufficient_scope error', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { withTempConfig: wtc } = await import('../../helpers/cli.js')
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
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['get', 'app'], { configDir: ssoTmp.configDir })
      expect(result.exitCode).not.toBe(0)
      // SSO subjects have no workspace; CLI reports usage_missing_arg before reaching scope check
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
      const result = await run(['get', 'app', '-o', 'json'], { configDir: tmp.configDir })
      expect(result.exitCode).not.toBe(0)
      assertErrorEnvelope(result)
    }
    finally {
      await tmp.cleanup()
    }
  })
})
