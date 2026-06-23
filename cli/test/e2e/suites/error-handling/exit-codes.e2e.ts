/**
 * E2E: Exit Code standards — spec 5.4
 *
 * Exit code contract:
 *   0  — success (also: --help, version, empty command)
 *   1  — server / resource error (not_found, server_5xx, network)
 *   2  — usage / argument error (unknown flag, invalid value, missing arg)
 *   4  — authentication error (not_logged_in, token expired)
 *   6  — config schema error (config parse failure, unsupported version)
 *
 * Already covered in other suites (not duplicated here):
 *   5.90  success exit 0          → all passing tests in every suite
 *   5.91  usage error exit 2      → get-app-list (--limit 0/201), run-app-basic
 *   5.92  app not found exit 1    → get-app-single
 *   5.93  auth error exit 4       → get-app-list, auth suites, run-app-basic
 *   5.94  insufficient_scope      → get-app-list (SSO guard)
 *   5.96  network error           → get-app-list, get-app-single, devices
 *   5.98  Ctrl+C streaming        → run-app-streaming.e2e.ts
 *   5.99  Ctrl+C streaming        → run-app-streaming.e2e.ts
 *   5.100 server 500 exit 1       → get-app-single, error-messages
 *   5.101 invalid input exit 2/1  → run-app-basic (many cases)
 *   5.109 unknown command exit 1  → error-handling/error-messages.e2e.ts (5.59)
 *   5.111 failed stdout empty     → run-app-basic, get-app-list (many)
 *
 * Non-automatable cases (excluded):
 *   5.97  timeout exit — cannot reliably control request timeout
 *   5.102 file upload failure — hard to trigger non-ENOENT upload failure
 *   5.103 workflow node failure  — no stable staging fixture
 *   5.115 shell stays healthy after failure — needs real shell context
 *   5.116 crash exit — cannot reliably trigger CLI crash
 *   5.117 panic output — cannot reliably trigger panic
 */

import type { AuthFixture } from '@test/e2e/helpers/cli.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertExitCode, assertNonZeroExit } from '@test/e2e/helpers/assert.js'
import { run, withAuthFixture, withTempConfig } from '@test/e2e/helpers/cli.js'
import { resolveEnv } from '@test/e2e/setup/env.js'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { ZERO } from '@/util/uuid.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('@test/e2e/setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / exit code standards (spec 5.4)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── 5.95  Corrupt config → exit 6 ─────────────────────────────────────────

  it('[P0] 5.95 corrupt config.yml causes a non-zero exit (exit 6 — config_schema_unsupported)', async () => {
    // Spec 5.95: when config.yml contains invalid YAML the CLI must exit with
    // a non-zero code. In practice the CLI exits 6 (config_schema_unsupported).
    const corruptTmp = await withTempConfig()
    try {
      await writeFile(
        join(corruptTmp.configDir, 'config.yml'),
        ': broken yaml [[[',
        { mode: 0o600 },
      )
      const result = await run(['config', 'get', 'defaults.format'], {
        configDir: corruptTmp.configDir,
      })
      expect(result.exitCode).toBe(6)
    }
    finally {
      await corruptTmp.cleanup()
    }
  })

  // ── 5.104  Failed + -o json exit code (WTA-249) ───────────────────────────

  it('[P0] 5.104 failed command with -o json returns non-zero exit — documents WTA-249 known defect', async () => {
    // Spec 5.104: a failed command with -o json must return a non-zero exit code.
    // WTA-249 has been fixed: app not found now correctly returns exit 1.
    //
    // Scenario: get app with a non-existent UUID + -o json → server_4xx_other
    const result = await fx.r([
      'get',
      'app',
      ZERO,
      '-o',
      'json',
    ])
    // WTA-249 has been fixed in the current build: 4xx with -o json now
    // correctly returns exit 1.
    expect(result.exitCode, 'app not found with -o json must exit 1 (WTA-249 fixed)').toBe(1)
    // stderr must still contain the JSON error envelope
    expect(result.stderr).toMatch(/app not found|server_4xx|error/i)
  })

  // ── 5.105  Failed + -o yaml exit code ────────────────────────────────────

  it('[P1] 5.105 failed command with -o yaml returns a non-zero exit code', async () => {
    // Spec 5.105: -o yaml on a failing command must not swallow the exit code.
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['get', 'app', '-o', 'yaml'], {
        configDir: unauthTmp.configDir,
      })
      assertNonZeroExit(result)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  // ── 5.106  --help exit 0 ──────────────────────────────────────────────────

  it('[P1] 5.106 difyctl --help exits with code 0', async () => {
    // Spec 5.106: help output must not be treated as an error.
    const result = await fx.r(['--help'])
    assertExitCode(result, 0)
  })

  // ── 5.107  version exit 0 ─────────────────────────────────────────────────

  it('[P1] 5.107 difyctl version exits with code 0', async () => {
    // Spec 5.107: --version does not exist; the correct command is "version".
    const result = await fx.r(['version'])
    assertExitCode(result, 0)
  })

  // ── 5.108  Empty command exit 0 ───────────────────────────────────────────

  it('[P1] 5.108 difyctl with no arguments exits with code 0 (displays help)', async () => {
    // Spec 5.108: running difyctl without arguments prints help and exits 0.
    const result = await fx.r([])
    assertExitCode(result, 0)
    // Must print some usage/command output
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  // ── 5.112  Successful command stderr is empty ─────────────────────────────

  it('[P1] 5.112 a successful query command produces no stderr output', async () => {
    // Spec 5.112: on success stderr must be empty (no spurious warnings).
    // Using get app -o json --limit 1 which has no hint or side-channel output.
    const result = await fx.r(['get', 'app', '-o', 'json', '--limit', '1'])
    assertExitCode(result, 0)
    expect(result.stderr.trim(), 'stderr must be empty on successful query').toBe('')
  })

  // ── 5.113  Repeated identical failure → consistent exit code ──────────────

  it('[P1] 5.113 repeated identical failure commands return the same exit code each time', async () => {
    // Spec 5.113: exit codes must be deterministic — the same error condition
    // must always produce the same exit code.
    const unauthTmp = await withTempConfig()
    try {
      const r1 = await run(['get', 'app'], { configDir: unauthTmp.configDir })
      const r2 = await run(['get', 'app'], { configDir: unauthTmp.configDir })
      expect(r1.exitCode).toBe(r2.exitCode)
      expect(r1.exitCode).not.toBe(0)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  // ── 5.114  Exit code classification ──────────────────────────────────────

  it('[P1] 5.114 exit codes follow the classification: usage=2, auth=4, server=1', async () => {
    // Spec 5.114: the three main exit code classes must be distinct and correct.

    // Class 2 — usage/argument error
    const usageResult = await fx.r(['get', 'app', '-o', 'table'])
    expect(usageResult.exitCode, 'illegal -o value must exit 2').toBe(2)

    // Class 4 — authentication error
    const unauthTmp = await withTempConfig()
    let authExitCode: number
    try {
      const authResult = await run(['get', 'app'], { configDir: unauthTmp.configDir })
      authExitCode = authResult.exitCode
    }
    finally {
      await unauthTmp.cleanup()
    }
    expect(authExitCode!, 'not_logged_in must exit 4').toBe(4)

    // Class 1 — server/resource error (not_found, server_5xx, network)
    const serverResult = await fx.r([
      'use',
      'workspace',
      'nonexistent-workspace-id-xyz',
    ])
    expect(serverResult.exitCode, 'workspace not found must exit 1').toBe(1)
  })
})
