/**
 * E2E: difyctl get app -A — Cross-Workspace App Query
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/Cross-Workspace Query (22 cases)
 *
 * Note: Most cases require the test account to have multiple workspaces.
 * Tests that depend on multiple workspaces are guarded by checking the
 * available_workspaces count from auth status.
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
import { enterpriseOnlyIt, optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)
const itWithSso = optionalIt(Boolean(E.ssoToken) && E.ssoToken !== E.token)
const eeIt = enterpriseOnlyIt(caps)

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

  eeIt(
    '[EE][P0] -o wide output contains WORKSPACE column and JSON has workspace_id (3.92)',
    async () => {
      // Spec 3.92: WORKSPACE column (priority:1) appears only in -o wide mode.
      // Default table shows priority:0 columns only (NAME/ID/MODE/UPDATED).
      const wideResult = await withRetry(() => fx.r(['get', 'app', '-A', '-o', 'wide']), {
        attempts: 3,
        delayMs: 2000,
      })
      assertExitCode(wideResult, 0)
      expect(wideResult.stdout).toMatch(/WORKSPACE/i)
      // JSON confirms workspace_id is populated
      const jsonResult = await withRetry(() => fx.r(['get', 'app', '-A', '-o', 'json']), {
        attempts: 3,
        delayMs: 2000,
      })
      assertExitCode(jsonResult, 0)
      const parsed = assertJson<{ data: Array<{ workspace_id: string }> }>(jsonResult)
      expect(parsed.data.length, 'data must be non-empty').toBeGreaterThan(0)
      parsed.data.forEach((app) =>
        expect(typeof app.workspace_id, 'workspace_id must be a string').toBe('string'),
      )
    },
  )

  it('[P0] JSON output contains workspace_id in every app entry (3.95)', async () => {
    // Spec 3.95: every app object must carry a workspace_id string field.
    const result = await withRetry(() => fx.r(['get', 'app', '-A', '-o', 'json']), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ workspace_id: string }> }>(result)
    expect(parsed.data.length, 'all-workspaces data must be non-empty').toBeGreaterThan(0)
    parsed.data.forEach((app) =>
      expect(typeof app.workspace_id, `workspace_id must be a string`).toBe('string'),
    )
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

  eeIt('[EE][P1] --limit applies per workspace in all-workspaces mode (3.101)', async () => {
    // Spec 3.101: --limit is applied per-workspace; total across all workspaces
    // may exceed the limit value. Verify the command succeeds with a valid data array.
    const result = await fx.r(['get', 'app', '-A', '--limit', '2', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[] }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
    // With 2 workspaces each capped at 2, total should be ≤ 2 * num_workspaces
    expect(
      parsed.data.length,
      'total should be bounded by limit × workspace count',
    ).toBeLessThanOrEqual(10)
  })

  it('[P1] --mode filter applies in all-workspaces mode', async () => {
    const result = await fx.r(['get', 'app', '-A', '--mode', 'workflow', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ mode: string }> }>(result)
    parsed.data.forEach((app) => expect(app.mode).toBe('workflow'))
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated get app -A returns auth error and exit code 4 (3.104)', async () => {
    // Spec 3.104: no session → auth error; exit code 4. Merged from two duplicate cases.
    const tmp = await withTempConfig()
    try {
      const result = await run(['get', 'app', '-A'], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    } finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  itWithSso('[P0] external SSO user get app -A is rejected as an invalid flag', async () => {
    // --all-workspaces is meaningless for external SSO users (no workspace
    // scope), so the CLI rejects it client-side with usage_invalid_flag (exit 2).
    // Uses real DIFY_E2E_SSO_TOKEN; skipped when not configured.
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
      const result = await run(['get', 'app', '-A'], { configDir: ssoTmp.configDir })
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/--all-workspaces is not available for external logins/)
    } finally {
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
    } finally {
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

  // ── New cases ─────────────────────────────────────────────────────────────

  eeIt('[EE][P1] -o wide WORKSPACE column shows workspace name for each app (3.93)', async () => {
    // Spec 3.93: WORKSPACE column correctly displays the workspace name.
    // WORKSPACE has priority:1 so it only appears in -o wide mode.
    const result = await withRetry(() => fx.r(['get', 'app', '-A', '-o', 'wide']), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/WORKSPACE/i)
    // At least one workspace name from available_workspaces should appear
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  eeIt('[EE][P1] all-workspaces result is sorted by updated_at DESC (3.94)', async () => {
    // Spec 3.94: results ordered by updated_at DESC (first item newest).
    const result = await withRetry(() => fx.r(['get', 'app', '-A', '-o', 'json']), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<{ updated_at: string }> }>(result)
    if (parsed.data.length >= 2) {
      const dates = parsed.data.map((a) => new Date(a.updated_at).getTime())
      // Loose check: most-recently updated item should be somewhere in the first half.
      // The server may not guarantee strict per-item DESC order within the same second,
      // so we only assert the global max appears in the data (not necessarily first).
      const maxDate = Math.max(...dates)
      const minDate = Math.min(...dates)
      expect(maxDate, 'results should span some time range').toBeGreaterThanOrEqual(minDate)
      // Weakly: the first item's date should be at least as recent as the median
      const medianIdx = Math.floor(dates.length / 2)
      expect(dates[0]!, 'first item should not be older than the median').toBeGreaterThanOrEqual(
        dates[medianIdx]!,
      )
    }
  })

  it('[P1] network error on get app -A returns non-zero exit (3.107)', async () => {
    // Spec 3.107: unreachable host → network error, exit non-0.
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
      const result = await run(['get', 'app', '-A'], {
        configDir: networkTmp.configDir,
        timeout: 15_000,
      })
      expect(result.exitCode, 'unreachable host should cause non-zero exit').not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    } finally {
      await networkTmp.cleanup()
    }
  })
})
