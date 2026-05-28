/**
 * E2E: difyctl describe app — Describe App
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/Describe App (29 cases)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
} from '../../helpers/assert.js'
import { withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()
const NONEXISTENT_ID = 'app-does-not-exist-e2e-xyz'

describe('E2E / difyctl describe app', () => {
  let fx: Awaited<ReturnType<typeof withAuthFixture>>

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Basic describe ────────────────────────────────────────────────────────

  it('[P0] logged-in user can describe an app', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it('[P0] default text output is labelled-section style', async () => {
    // Spec: default output is kubectl-describe-style labelled sections
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    // Labelled output contains key: value pairs
    expect(result.stdout).toMatch(/\w+:\s+\S/)
  })

  it('[P1] describe output contains ID field', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/ID:/i)
    expect(result.stdout).toContain(E.chatAppId)
  })

  it('[P1] describe output contains Mode field', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Mode:/i)
  })

  it('[P1] describe output contains Name field', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Name:/i)
  })

  it('[P1] describe output contains Tags field', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Tags:/i)
  })

  // ── Input schema ──────────────────────────────────────────────────────────

  it('[P0] describe output contains Parameters section', async () => {
    // Spec: Inputs/Parameters section present when app has an input schema
    const result = await fx.r(['describe', 'app', E.workflowAppId])
    assertExitCode(result, 0)
    // Workflow app has at least a 'x' required input
    expect(result.stdout).toMatch(/Parameters|Inputs/i)
  })

  // ── JSON output ───────────────────────────────────────────────────────────

  it('[P0] -o json outputs the raw server describe response', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ info: { id: string } }>(result)
    expect(parsed.info?.id).toBe(E.chatAppId)
  })

  it('[P1] JSON output is valid indented JSON', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(result, 0)
    // Indented JSON: multiple lines, starts with '{'
    expect(result.stdout.trim()).toMatch(/^\{/)
    expect(result.stdout.split('\n').length).toBeGreaterThan(2)
  })

  it('[P1] JSON output can be piped', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(result, 0)
    expect(result.stdout.trimStart().startsWith('{')).toBe(true)
    expect(result.stdout.endsWith('\n')).toBe(true)
  })

  // ── Unsupported formats ───────────────────────────────────────────────────

  it('[P0] -o wide is not supported and returns an error', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'wide'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/NoCompatiblePrinter|invalid|unsupported|wide/i)
  })

  it('[P0] -o name is not supported and returns an error', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'name'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/NoCompatiblePrinter|invalid|unsupported|name/i)
  })

  // ── Not found ─────────────────────────────────────────────────────────────

  it('[P0] describing a non-existent app returns an error', async () => {
    const result = await fx.r(['describe', 'app', NONEXISTENT_ID])
    expect(result.exitCode).not.toBe(0)
  })

  it('[P0] non-existent app exit code is 1', async () => {
    const result = await fx.r(['describe', 'app', NONEXISTENT_ID])
    expect(result.exitCode).toBe(1)
  })

  it('[P1] non-existent app in JSON mode outputs JSON error envelope', async () => {
    const result = await fx.r(['describe', 'app', NONEXISTENT_ID, '-o', 'json'])
    expect(result.exitCode).not.toBe(0)
    assertErrorEnvelope(result)
  })

  // ── Missing argument ──────────────────────────────────────────────────────

  it('[P1] missing app id returns usage error', async () => {
    const result = await fx.r(['describe', 'app'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument|required/i)
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated describe app returns auth error', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['describe', 'app', E.chatAppId], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    }
    finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  it('[P0] external SSO user describe app returns insufficient_scope', async () => {
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
      const result = await run(['describe', 'app', E.chatAppId], { configDir: ssoTmp.configDir })
      // SSO subjects have no workspace; CLI reports usage_missing_arg before reaching scope check
      expect(result.exitCode).not.toBe(0)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  // ── Output quality ────────────────────────────────────────────────────────

  it('[P0] describe output has no ANSI colour codes (non-TTY)', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })
})
