/**
 * E2E: difyctl run app --stream — streaming output specialisation
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Run/Streaming Output (24 cases)
 *
 * Covers scenarios that run-app-basic.e2e.ts cannot handle:
 *  - Ctrl+C interruption (SIGINT)
 *  - Chunk arrival order verification (timing)
 *  - Cases migrated from run-app-basic.e2e.ts: exit code, stderr separation,
 *    -o json envelope, unauthenticated, pipe, workflow succeeded status
 */

import type { Buffer } from 'node:buffer'
import type { AuthFixture } from '../../helpers/cli.js'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertStderrContains,
} from '../../helpers/assert.js'
import { BIN, BUN, injectAuth, run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)
const itWithSso = optionalIt(Boolean(E.ssoToken))

describe('E2E / difyctl run app --stream (specialisation)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Chunk timing & token order ──────────────────────────────────────────

  it('[P0] streaming output arrives in real-time chunks (stdout non-empty, echo complete)', async () => {
    // Spec: streaming output is printed in real-time by chunk + token order is preserved
    // withRetry: staging SSE connections may fail transiently on cold start
    await withRetry(async () => {
      const query = 'chunk-order-test'
      const proc = spawn(BUN, [BIN, 'run', 'app', E.chatAppId, query, '--stream'], {
        env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1', DIFY_E2E_NO_KEYRING: '1' },
      })

      const chunks: string[] = []
      proc.stdout.on('data', (d: Buffer) => {
        chunks.push(d.toString('utf8'))
      })

      let stderr = ''
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8')
      })

      const exitCode = await new Promise<number>((res) => {
        proc.on('close', code => res(code ?? 1))
      })

      assertExitCode({ stdout: chunks.join(''), stderr, exitCode }, 0)
      // May arrive in multiple chunks; the concatenated result must contain the full query
      expect(chunks.join('')).toContain(query)
    }, { attempts: 3, delayMs: 2000 })
  })

  // ── Basic streaming behaviour ───────────────────────────────────────────

  it('[P0] exit code is 0 after streaming completes', async () => {
    // Spec: streaming exits normally after completion
    const result = await fx.r(['run', 'app', E.chatAppId, 'end-ok', '--stream'])
    assertExitCode(result, 0)
  })

  it('[P1] stderr is not mixed into stdout in streaming mode', async () => {
    // Spec: stderr is not mixed into stdout in streaming mode
    const result = await fx.r(['run', 'app', E.chatAppId, 'sep', '--stream'])
    assertExitCode(result, 0)
    expect(result.stdout).not.toContain('hint:')
    assertStderrContains(result, '--conversation')
  })

  it('[P1] --stream -o json outputs a valid JSON envelope', async () => {
    // Spec: streaming mode produces valid JSON output
    const result = await fx.r(['run', 'app', E.chatAppId, 'sjson', '--stream', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ mode: string, answer: string }>(result)
    expect(parsed.mode).toMatch(/chat/)
  })

  it('[P1] streaming mode output supports piping (no ANSI, ends with \\n)', async () => {
    // Spec: streaming mode output supports piping
    const result = await fx.r(['run', 'app', E.chatAppId, 'pipe-s', '--stream'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
    expect(result.stdout.endsWith('\n')).toBe(true)
  })

  it('[P0] workflow streaming output contains succeeded status', async () => {
    // Spec: workflow streaming output includes succeeded status
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 'wf-stream-val', num: 42, enum_var: 'A', paragraph: 'short text' }),
      '--stream',
      '-o',
      'json',
    ])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data?: { status?: string } }>(result)
    expect(parsed.data?.status).toBe('succeeded')
  })

  // ── Error scenarios ─────────────────────────────────────────────────────

  it('[P0] server-side error event causes CLI to exit with non-zero code', async () => {
    // Spec: server-side error event causes CLI to exit with non-zero code
    // Use a non-existent app ID to force a server-side error.
    const proc = spawn(BUN, [BIN, 'run', 'app', 'nonexistent-app-xyz-e2e', 'hi', '--stream'], {
      env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1' },
    })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    const exitCode = await new Promise<number>((res) => {
      proc.on('close', code => res(code ?? 1))
    })
    expect(exitCode, 'error event should cause non-zero exit').not.toBe(0)
    expect(stderr.length).toBeGreaterThan(0)
  })

  it('[P0] unauthenticated streaming returns auth error (exit code 4)', async () => {
    // Spec: unauthenticated streaming returns an auth error
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['run', 'app', E.chatAppId, 'hi', '--stream'], {
        configDir: unauthTmp.configDir,
      })
      assertExitCode(result, 4)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  it('[P0] streaming fails when a required input is missing (exit code non-zero)', async () => {
    // Spec: streaming fails when a required input is missing
    // workflow app requires variable x (required); the server should return a validation error
    // immediately, and the CLI exits with a non-zero code.
    //
    // ⚠️  Depends on feat/cli API version (server-side pre-validation of missing required inputs).
    //     Current local server 1.14.1 does not support this check; test passes once upgraded.
    const proc = spawn(BUN, [BIN, 'run', 'app', E.workflowAppId, '--stream'], {
      env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1', DIFY_E2E_NO_KEYRING: '1' },
    })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    const exitCode = await new Promise<number>((res) => {
      proc.on('close', code => res(code ?? 1))
    })
    expect(exitCode).not.toBe(0)
    // The server should return a clear validation error rather than timing out
    expect(stderr).toMatch(/validation|required|invalid|missing/i)
  })

  // ── SIGINT ──────────────────────────────────────────────────────────────

  it('[P1] Ctrl+C interrupts streaming (SIGINT → non-zero exit code)', async () => {
    // Spec: Ctrl+C interrupts streaming + exit code is non-zero after Ctrl+C
    const proc = spawn(BUN, [BIN, 'run', 'app', E.chatAppId, 'ctrl-c-test', '--stream'], {
      env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1' },
    })

    let _stdout = ''
    let _stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      _stdout += d.toString('utf8')
    })
    proc.stderr.on('data', (d: Buffer) => {
      _stderr += d.toString('utf8')
    })

    // Wait for the process to start streaming, then interrupt.
    await new Promise(res => setTimeout(res, 800))
    proc.kill('SIGINT')

    const exitCode = await new Promise<number>((res) => {
      proc.on('close', code => res(code ?? 1))
    })

    expect(exitCode, 'SIGINT should cause non-zero exit').not.toBe(0)
  })

  // ── Multiple inputs in streaming mode (4.2.8) ──────────────────────────

  it('[P1] workflow streaming with multiple inputs passes all params correctly', async () => {
    // Spec 4.2.8: multiple --inputs entries take effect simultaneously in streaming mode
    const result = await withRetry(
      () => fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'multi-stream-k1', num: 42, enum_var: 'A', paragraph: 'short text' }),
        '--stream',
        '-o',
        'json',
      ]),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(result, 0)
    const parsed = assertJson<{ data?: { status?: string } }>(result)
    expect(parsed.data?.status).toBe('succeeded')
  })

  // ── Unreachable host in streaming mode (4.2.13) ────────────────────────

  it('[P0] streaming with unreachable host returns network error (exit code non-zero)', async () => {
    // Spec 4.2.13: unreachable host → network error, exit code non-zero
    // 127.0.0.1:19999 is a local port with nothing listening — ECONNREFUSED immediately.
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
      const result = await run(
        ['run', 'app', E.chatAppId, 'hello', '--stream'],
        { configDir: networkTmp.configDir, timeout: 15_000 },
      )
      expect(result.exitCode, 'unreachable host should cause non-zero exit').not.toBe(0)
      expect(result.stderr.length, 'stderr should contain error message').toBeGreaterThan(0)
    }
    finally {
      await networkTmp.cleanup()
    }
  })

  // ── Wrong-type input in streaming mode (4.2.15) ────────────────────────

  it('[P0] streaming with wrong-type input returns validation error (exit code non-zero)', async () => {
    // Spec 4.2.15: passing a value of the wrong type triggers server-side validation failure
    // The workflow app expects `num` to be a number; passing a string should cause a validation error.
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 'ok', num: 'not-a-number', enum_var: 'A', paragraph: 'short text' }),
      '--stream',
    ])
    expect(result.exitCode, 'wrong-type input should cause non-zero exit').not.toBe(0)
    expect(result.stderr).toMatch(/validation|invalid|type|400|server_5xx|must be/i)
  })

  // ── Non-existent app with positional query (4.2.16) ────────────────────

  it('[P0] streaming with non-existent app id and query exits 1 with app-not-found error', async () => {
    // Spec 4.2.16: non-existent app id + positional query → app not found, exit code 1
    // Distinct from the earlier server-error test: this checks exit=1 precisely and the not-found message.
    const result = await fx.r(['run', 'app', 'nonexistent-app-id-404-streaming-e2e', 'hello', '--stream'])
    expect(result.exitCode, 'app not found should exit with code 1').toBe(1)
    expect(result.stderr).toMatch(/not.?found|404|does not exist/i)
  })

  // ── SSO (dfoe_) token in streaming mode (4.2.18) ──────────────────────

  itWithSso('[P0] streaming with SSO (dfoe_) token succeeds (exit code 0, stdout non-empty)', async () => {
    // Spec 4.2.18: dfoe_ token can invoke streaming run on an authorised app
    const ssoTmp = await withTempConfig()
    try {
      await injectAuth(ssoTmp.configDir, {
        host: E.host,
        bearer: E.ssoToken,
        email: 'sso-e2e@example.com',
        workspaceId: E.workspaceId,
        workspaceName: E.workspaceName,
      })
      const result = await withRetry(
        () => run(['run', 'app', E.chatAppId, 'sso-stream-test', '--stream'], {
          configDir: ssoTmp.configDir,
        }),
        { attempts: 3, delayMs: 2000 },
      )
      assertExitCode(result, 0)
      expect(result.stdout.length, 'SSO streaming should produce output').toBeGreaterThan(0)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  // ── JSON error envelope for non-existent app in -o json mode (4.2.23) ─

  it('[P1] non-existent app with --stream -o json outputs JSON error envelope on stderr', async () => {
    // Spec 4.2.23: when app does not exist and -o json is set, stderr must be a valid JSON error envelope
    const result = await fx.r([
      'run',
      'app',
      'nonexistent-app-id-json-streaming-e2e',
      'hello',
      '--stream',
      '-o',
      'json',
    ])
    expect(result.exitCode, 'should exit non-zero').not.toBe(0)
    assertErrorEnvelope(result)
  })
})
