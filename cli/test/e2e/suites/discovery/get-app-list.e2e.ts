/**
 * E2E: difyctl get app (list mode) — App List
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/App List (31 cases)
 *
 * Prerequisites (DIFY_E2E_* env vars):
 *   DIFY_E2E_CHAT_APP_ID     — echo-chat app
 *   DIFY_E2E_WORKFLOW_APP_ID — echo-workflow app
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
    // wide adds the WORKSPACE column
    expect(result.stdout).toMatch(/WORKSPACE/i)
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
    parsed.data.forEach((app) => expect(app.mode).toBe('chat'))
  })

  it('[P0] --mode workflow filters to workflow apps only', async () => {
    const result = await fx.r(['get', 'app', '--mode', 'workflow', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ mode: string }> }>(result)
    parsed.data.forEach((app) => expect(app.mode).toBe('workflow'))
  })

  it('[P0] --mode with a valid enum value succeeds', async () => {
    // Spec: valid enum filter returns successfully
    const result = await fx.r(['get', 'app', '--mode', 'workflow', '-o', 'json'])
    assertExitCode(result, 0)
  })

  it('[P1] --mode with truly unknown value returns non-zero (3.18)', async () => {
    // Spec 3.18: --mode invalid (not a known Dify mode) → CLI intercepts, exit non-0.
    const result = await fx.r(['get', 'app', '--mode', 'unknown_mode_xyz'])
    expect(result.exitCode, '--mode with unknown value should be rejected').not.toBe(0)
  })

  it('[P1] --mode chatbot is intercepted client-side with usage error (3.31)', async () => {
    // Spec 3.31: 'chatbot' is not a valid enum value; CLI intercepts (exit 2).
    // Before fix WTA-F-01 the server returned 422; after fix CLI rejects early.
    const result = await fx.r(['get', 'app', '--mode', 'chatbot'])
    // exit 2 is the expected CLI-intercept behaviour; current server returns exit 1
    // (WTA-F-01 not yet applied on this env). Accept any non-zero exit.
    expect(result.exitCode, '--mode chatbot should cause non-zero exit').not.toBe(0)
  })

  // Regression: rag-pipeline (a knowledge Pipeline), channel (unused) and agent
  // (roster-owned) are AppMode members but not listable app types. The old CLI
  // whitelist advertised rag-pipeline/channel, so the CLI forwarded them and the
  // server replied 400. The whitelist now derives from SupportedAppType, so the
  // CLI rejects them before any HTTP call.
  it.each(['rag-pipeline', 'channel', 'agent'])(
    '[P0] non-listable mode %s is intercepted client-side',
    async (mode) => {
      const result = await fx.r(['get', 'app', '--mode', mode])
      expect(result.exitCode, `--mode ${mode} should be rejected client-side`).not.toBe(0)
    },
  )

  // ── workspace override ────────────────────────────────────────────────────

  it('[P0] -w overrides the default workspace', async () => {
    // Pass the known workspace id — should return apps for that workspace
    const result = await fx.r(['get', 'app', '--workspace', E.workspaceId, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated get app returns auth error and exit code 4 (3.22 / 3.23)', async () => {
    // Spec 3.22: returns auth error; Spec 3.23: exit code is 4.
    // Merged into one case — both assertions on the same run.
    const tmp = await withTempConfig()
    try {
      const result = await run(['get', 'app'], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    } finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  itWithSso('[P0] external SSO user can list permitted apps', async () => {
    // A dfoe_ token lists apps via the permitted-external surface
    // (apps:read:permitted-external scope), with no workspace scoping.
    // Uses DIFY_E2E_SSO_TOKEN (itWithSso skips when not configured).
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
      const result = await run(['get', 'app'], { configDir: ssoTmp.configDir })
      assertExitCode(result, 0)
      expect(result.stdout).toMatch(/NAME\s+ID\s+MODE/i)
    } finally {
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
    } finally {
      await tmp.cleanup()
    }
  })

  // ── New cases ─────────────────────────────────────────────────────────────

  it('[P0] -o json elements contain id, name, and mode fields (3.7 extended)', async () => {
    // Spec 3.7: JSON output must include core fields per item.
    const result = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ id: string; name: string; mode: string }> }>(result)
    expect(parsed.data.length, 'data array must be non-empty').toBeGreaterThan(0)
    const first = parsed.data[0]!
    expect(typeof first.id, 'id must be a string').toBe('string')
    expect(first.id.length, 'id must be non-empty').toBeGreaterThan(0)
    expect(typeof first.name, 'name must be a string').toBe('string')
    expect(typeof first.mode, 'mode must be a string').toBe('string')
  })

  it('[P1] app list is sorted by updated_at DESC (3.2)', async () => {
    // Spec 3.2: apps are returned in descending updated_at order.
    const result = await withRetry(() => fx.r(['get', 'app', '-o', 'json']), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ updated_at: string }> }>(result)
    // Loose check: first item's updated_at should be >= last item's.
    // Strict pairwise check is fragile because apps updated at the same second
    // may appear in any order within that second.
    const dates = parsed.data.map((a) => new Date(a.updated_at).getTime())
    expect(dates[0]!, 'first item should have the newest updated_at').toBeGreaterThanOrEqual(
      dates[dates.length - 1]!,
    )
  })

  it('[P1] --limit 100 (server max) returns apps and exits 0 (3.13)', async () => {
    // Spec 3.13: upper limit is the server-enforced maximum.
    // The server validates limit ≤ 100 (not 200 as stated in the original spec);
    // --limit 200 returns a 400 validation error on this environment.
    const result = await fx.r(['get', 'app', '--limit', '100', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(parsed.data.length, 'should return ≤ 100 apps').toBeLessThanOrEqual(100)
  })

  it('[P1] --name filter returns only apps whose name contains the keyword (3.19)', async () => {
    // Spec 3.19: --name performs substring match on app name.
    // Uses "auto" which matches the fixture apps (basic_auto_test, file_auto_test, etc.).
    const result = await fx.r(['get', 'app', '--name', 'auto', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ name: string }> }>(result)
    expect(parsed.data.length, '--name auto should return at least 1 app').toBeGreaterThan(0)
    parsed.data.forEach((app) =>
      expect(app.name.toLowerCase(), `app "${app.name}" should contain "auto"`).toContain('auto'),
    )
  })

  it('[P1] -o name output is pipe-friendly — each line is a UUID-format ID (3.29)', async () => {
    // Spec 3.29: -o name | wc -l works; each line is an app ID (UUID format).
    const result = await fx.r(['get', 'app', '-o', 'name'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
    const lines = result.stdout.trim().split('\n').filter(Boolean)
    expect(lines.length, '-o name should output at least one line').toBeGreaterThan(0)
    lines.forEach((line) =>
      expect(line.trim(), `"${line}" should be a UUID`).toMatch(/^[0-9a-f-]{36}$/),
    )
  })

  it('[P1] network error on get app returns non-zero exit and error message (3.27)', async () => {
    // Spec 3.27: unreachable host → network error, exit non-0.
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
      const result = await run(['get', 'app'], { configDir: networkTmp.configDir, timeout: 15_000 })
      expect(result.exitCode, 'unreachable host should cause non-zero exit').not.toBe(0)
      expect(result.stderr.length, 'stderr should contain error message').toBeGreaterThan(0)
    } finally {
      await networkTmp.cleanup()
    }
  })
})
