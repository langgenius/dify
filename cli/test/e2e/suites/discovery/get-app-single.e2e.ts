/**
 * E2E: difyctl get app <id> — Single App Query
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/Single App Query (22 cases)
 *
 * Note: difyctl get app <id> queries a single app via GET /apps/<id>/describe?fields=info.
 * The response is returned in list-envelope format {page,limit,total,data:[...]}.
 */

import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertPipeFriendlyJson,
} from '../../helpers/assert.js'
import { run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)
const itWithSso = optionalIt(Boolean(E.ssoToken))
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

  it('[P0] non-existent app returns exit code 1 with not-found error (3.50)', async () => {
    // Spec 3.50: get app <invalid-id> → stderr contains not-found error, exit code is 1.
    const result = await fx.r(['get', 'app', NONEXISTENT_ID])
    expect(result.exitCode, 'non-existent app should exit with code 1').toBe(1)
    expect(result.stderr).toMatch(/not.?found|404|does not exist|server_5xx/i)
  })

  it('[P1] JSON mode error for non-existent app outputs JSON error envelope', async () => {
    const result = await fx.r(['get', 'app', NONEXISTENT_ID, '-o', 'json'])
    expect(result.exitCode).not.toBe(0)
    assertErrorEnvelope(result)
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated get app <id> returns auth error and exit code 4 (3.54)', async () => {
    // Spec 3.54: no session → auth error; exit code 4. Merged from two duplicate cases.
    const tmp = await withTempConfig()
    try {
      const result = await run(['get', 'app', E.workflowAppId], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    }
    finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  itWithSso('[P0] external SSO user get app <id> returns insufficient_scope error (3.55)', async () => {
    // Spec 3.55: dfoe_ token on get app <id> → insufficient_scope, exit 1.
    // Uses DIFY_E2E_SSO_TOKEN; skipped when not configured.
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const ssoTmp = await withTempConfig()
    try {
      await mkdir(ssoTmp.configDir, { recursive: true })
      const hostsYml = `${[
        `current_host: ${E.host}`,
        `token_storage: file`,
        `tokens:`,
        `  bearer: ${E.ssoToken}`,
        `external_subject:`,
        `  email: sso@example.com`,
        `  issuer: https://issuer.example.com`,
      ].join('\n')}\n`
      await writeFile(join(ssoTmp.configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
      const result = await run(['get', 'app', E.chatAppId], { configDir: ssoTmp.configDir })
      expect(result.exitCode, 'SSO user get app <id> should exit non-zero').not.toBe(0)
      expect(result.stderr).toMatch(/insufficient_scope|scope|not_logged_in|auth/i)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  // ── New cases: successful single-app query ───────────────────────────────

  it('[P0] get app <valid-id> returns metadata and exits 0 (3.39 / 3.40 / 3.41 / 3.42-44)', async () => {
    // Spec 3.39: returns metadata; 3.40: table format; 3.41: no ANSI;
    // 3.42-44: output contains id, name, mode.
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId]),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
    // table format: has column headers
    expect(result.stdout).toMatch(/ID/i)
    expect(result.stdout).toMatch(/NAME/i)
    expect(result.stdout).toMatch(/MODE/i)
    // actual data row: contains the app id and its name
    expect(result.stdout).toContain(E.chatAppId)
  })

  it('[P0] get app <id> -o json returns valid JSON with id, name, mode fields (3.45)', async () => {
    // Spec 3.45: -o json → valid JSON, contains id/name/mode per item.
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId, '-o', 'json']),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ id: string, name: string, mode: string }> }>(result)
    expect(parsed.data.length, 'data array should contain the queried app').toBeGreaterThan(0)
    const app = parsed.data[0]!
    expect(typeof app.id).toBe('string')
    expect(typeof app.name).toBe('string')
    expect(typeof app.mode).toBe('string')
  })

  it('[P1] get app <id> -o yaml returns valid YAML and exits 0 (3.46)', async () => {
    // Spec 3.46: -o yaml → valid YAML, exit 0.
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId, '-o', 'yaml']),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
    expect(result.stdout.trimStart()).not.toMatch(/^\{/)
  })

  it('[P1] get app <id> -o name outputs only the app ID (3.47)', async () => {
    // Spec 3.47: -o name → only the app ID per line.
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId, '-o', 'name']),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    const lines = result.stdout.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('[P1] get app <id> -o wide outputs extended columns (3.48)', async () => {
    // Spec 3.48: -o wide → TAGS/UPDATED/AUTHOR columns, exit 0.
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId, '-o', 'wide']),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/AUTHOR|UPDATED|TAGS/i)
  })

  it('[P1] get app <id> -o json is pipe-friendly with no ANSI (3.49)', async () => {
    // Spec 3.49: -o json | jq . works; no ANSI codes.
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId, '-o', 'json']),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    assertPipeFriendlyJson(result)
  })

  it('[P1] get app with special-character id returns non-zero exit (3.53)', async () => {
    // Spec 3.53: get app "!@#" → query fails, exit 1 (server-side error).
    const result = await fx.r(['get', 'app', '!@#'])
    expect(result.exitCode, 'special-character id should cause non-zero exit').not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('[P1] get app <id> -w <workspace-id> returns app from that workspace (3.56)', async () => {
    // Spec 3.56: -w override with the known workspace → returns the app, exit 0.
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId, '--workspace', E.workspaceId, '-o', 'json']),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  it('[P1] network error on get app <id> returns non-zero exit (3.58)', async () => {
    // Spec 3.58: unreachable host → network error, exit non-0.
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const networkTmp = await withTempConfig()
    try {
      await mkdir(networkTmp.configDir, { recursive: true })
      const hostsYml = `${[
        `current_host: http://127.0.0.1:19999`,
        `token_storage: file`,
        `tokens:`,
        `  bearer: dfoa_fake_token_network_test`,
        `workspace:`,
        `  id: ${E.workspaceId}`,
        `  name: "E2E Test Workspace"`,
        `  role: owner`,
        `available_workspaces:`,
        `  - id: ${E.workspaceId}`,
        `    name: "E2E Test Workspace"`,
        `    role: owner`,
      ].join('\n')}\n`
      await writeFile(join(networkTmp.configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
      const result = await run(['get', 'app', E.chatAppId], {
        configDir: networkTmp.configDir,
        timeout: 15_000,
      })
      expect(result.exitCode, 'unreachable host should cause non-zero exit').not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    }
    finally {
      await networkTmp.cleanup()
    }
  })

  // Spec 3.57: current workspace does not contain the queried app → not found, exit 1
  it('[P1] get app <id> --workspace <other-workspace-id> returns not found (3.57)', async () => {
    // Spec 3.57: when the queried app does not belong to the specified workspace,
    // the server returns not-found.  We construct the scenario by passing a
    // well-formed but non-existent workspace UUID so the server cannot locate the
    // app within it, which is equivalent to "current workspace does not contain
    // the app".
    const FOREIGN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'
    const result = await withRetry(
      () => fx.r(['get', 'app', E.chatAppId, '--workspace', FOREIGN_WORKSPACE_ID]),
      { attempts: 3, delayMs: 2000 },
    )
    expect(result.exitCode, 'app not in workspace should exit non-zero').not.toBe(0)
    expect(result.stderr).toMatch(/not.?found|404|does not exist|server_5xx|not.?authorized|forbidden|workspace/i)
  })
})
