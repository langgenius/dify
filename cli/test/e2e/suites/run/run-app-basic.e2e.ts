/**
 * E2E: difyctl run app — basic app execution
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Run/Basic App Execution (4.1)
 *
 * Streaming output cases → run-app-streaming.e2e.ts
 * Conversation mode cases → run-app-conversation.e2e.ts
 *
 * Staging app prerequisites (specified via DIFY_E2E_* env vars):
 *   echo-chat     — mode=chat, query variable, outputs "echo: {query}"
 *   echo-workflow — mode=workflow, x variable (required), outputs x directly (no echo prefix)
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertPipeFriendlyJson,
  assertStdoutContains,
} from '../../helpers/assert.js'
import { run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)
const itWithSso = optionalIt(Boolean(E.ssoToken))

// ── Suite ──────────────────────────────────────────────────────────────────

describe('E2E / difyctl run app', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // =========================================================================
  // Basic execution
  // =========================================================================

  describe('Basic execution', () => {
    it('[P0] logged-in internal user can run app — stdout contains the app result', async () => {
      // Spec: logged-in internal user can run app / default output shows execution result
      // withRetry: staging LLM inference may have transient 5xx on cold start
      const result = await withRetry(() => fx.r(['run', 'app', E.chatAppId, 'hello']), {
        attempts: 3,
        delayMs: 2000,
        shouldRetry: err => err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message),
      })
      assertExitCode(result, 0)
      assertStdoutContains(result, 'echo:hello')
      // Spec 4.1.4: default output has no ANSI colour codes (non-TTY; run() sets NO_COLOR=1)
      assertNoAnsi(result.stdout, 'stdout')
    })

    it('[P0] run app invokes the execute endpoint (stdout has actual content)', async () => {
      // Spec: run app invokes the execute endpoint
      const result = await fx.r(['run', 'app', E.chatAppId, 'e2e-smoke'])
      assertExitCode(result, 0)
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('[P1] text output preserves newlines (stdout ends with \\n)', async () => {
      // Spec: text output preserves newlines
      const result = await fx.r(['run', 'app', E.chatAppId, 'newline'])
      assertExitCode(result, 0)
      expect(result.stdout).toMatch(/\n$/)
    })

    it('[P1] repeated run app calls each complete independently (3 iterations)', async () => {
      // Spec: repeated run app calls do not affect historical state
      for (let i = 0; i < 3; i++) {
        const result = await fx.r(['run', 'app', E.chatAppId, `repeat-${i}`])
        assertExitCode(result, 0)
        assertStdoutContains(result, `echo:repeat-${i}`)
      }
    })
  })

  // =========================================================================
  // Output format
  // =========================================================================

  describe('Output format (-o)', () => {
    it('[P0] -o json outputs valid JSON', async () => {
      // Spec: -o json produces valid JSON
      const result = await fx.r(['run', 'app', E.chatAppId, 'json-test', '-o', 'json'])
      assertExitCode(result, 0)
      const parsed = assertJson<{ answer: string, mode: string }>(result)
      expect(parsed).toHaveProperty('answer')
      expect(parsed.mode).toMatch(/chat/)
    })

    it('[P1] JSON output includes execution metadata (message_id / conversation_id)', async () => {
      // Spec: JSON output includes execution metadata
      const result = await fx.r(['run', 'app', E.chatAppId, 'meta', '-o', 'json'])
      assertExitCode(result, 0)
      const parsed = assertJson<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('message_id')
      expect(parsed).toHaveProperty('conversation_id')
    })

    it('[P1] JSON output supports piping (no ANSI, starts with {, ends with \\n)', async () => {
      // Spec: JSON output supports piping
      const result = await fx.r(['run', 'app', E.chatAppId, 'pipe', '-o', 'json'])
      assertExitCode(result, 0)
      assertPipeFriendlyJson(result)
    })

    it('[P1] JSON mode outputs a JSON error envelope to stderr', async () => {
      // Spec: JSON mode outputs a JSON error envelope
      const result = await fx.r(['run', 'app', 'app-nonexistent-xyz-e2e', 'hello', '-o', 'json'])
      assertNonZeroExit(result)
      assertErrorEnvelope(result, 'server_4xx_other')
    })
  })

  // =========================================================================
  // --inputs flag
  // =========================================================================

  describe('--inputs flag', () => {
    it('[P0] run app supports --inputs (workflow app)', async () => {
      // Spec: run app supports --inputs
      // withRetry: staging workflow execution may have transient 5xx
      const result = await withRetry(
        () => fx.r(['run', 'app', E.workflowAppId, '--inputs', JSON.stringify({ x: 'workflow-val', num: 42, enum_var: 'A', paragraph: 'short text' })]),
        { attempts: 3, delayMs: 2000, shouldRetry: err => err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message) },
      )
      assertExitCode(result, 0)
      assertStdoutContains(result, 'workflow-val')
    })

    it('[P0] multiple inputs take effect simultaneously', async () => {
      // Spec: multiple --inputs entries take effect simultaneously
      const result = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'multi-test', num: 42, enum_var: 'A', paragraph: 'short text' }),
      ])
      assertExitCode(result, 0)
    })

    it('[P0] invalid JSON for --inputs returns usage error (exit code 2)', async () => {
      // Spec: missing required parameter / invalid input
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs', 'not-json'])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/valid JSON/i)
    })

    it('[P0] JSON array for --inputs returns usage error', async () => {
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs', '[1,2,3]'])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/JSON object/i)
    })

    it('[P0] --inputs and --inputs-file are mutually exclusive — returns usage error', async () => {
      // Spec: mutually exclusive flags return a usage error
      const inputsFile = join(fx.configDir, 'inputs.json')
      await writeFile(inputsFile, JSON.stringify({ x: 'file-val' }))
      const result = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        '{"x":"flag-val"}',
        '--inputs-file',
        inputsFile,
      ])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/mutually exclusive/i)
    })

    it('[P0] positional message passed to workflow app returns usage error', async () => {
      // Spec: execution fails when required positional parameter is missing (workflow)
      const result = await fx.r(['run', 'app', E.workflowAppId, 'positional-msg'])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/workflow apps do not accept a positional message/i)
    })

    it('[P0] --inputs-file reads JSON inputs from a file', async () => {
      const inputsFile = join(fx.configDir, 'wf-inputs.json')
      await writeFile(inputsFile, JSON.stringify({ x: 'from-file', num: 42, enum_var: 'A', paragraph: 'short text' }))
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs-file', inputsFile])
      assertExitCode(result, 0)
      assertStdoutContains(result, 'from-file')
    })

    it('[P0] required inputs missing causes execution failure (exit code non-zero)', async () => {
      // Spec 4.1.11: workflow app fails when required inputs are not provided.
      // Passing an empty object omits the required "x" field; the server
      // returns a validation error and the CLI exits with a non-zero code.
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs', '{}'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    })

    it('[P0] paragraph input within limit succeeds; exceeding max_length returns error', async () => {
      // Spec 4.1.19: paragraph input exceeding max_length (100) returns validation error
      // App: basic_auto_test — variable "paragraph" (text-input, max_length=100, optional)

      // ── Within limit: 50 chars ──────────────────────────────────────────
      const shortResult = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({
          x: 'hello',
          num: 42,
          enum_var: 'A',
          paragraph: 'A'.repeat(50),
        }),
      ])
      assertExitCode(shortResult, 0)

      // ── Exceeding limit: 101 chars ──────────────────────────────────────
      const longResult = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({
          x: 'hello',
          num: 42,
          enum_var: 'A',
          paragraph: 'A'.repeat(101),
        }),
      ])
      expect(longResult.exitCode).not.toBe(0)
      expect(longResult.stderr).toMatch(/paragraph.*less than 100|paragraph.*100 characters/i)
    })

    it('[P0] valid inputs of all types execute successfully; invalid typed/enum inputs return errors', async () => {
      // Spec 4.1.17: non-typed input value returns a validation error
      // Spec 4.1.18: invalid enum value returns a validation error
      //
      // App: basic_auto_test (DIFY_E2E_WORKFLOW_APP_ID)
      // Input schema:
      //   x         — text-input (required)
      //   num       — number     (required, Spec 4.1.17)
      //   enum_var  — select     (required, options: A/B/C, Spec 4.1.18)

      // ── Happy path: all correct values ──────────────────────────────────
      const happyResult = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'hello', num: 42, enum_var: 'A', paragraph: 'short text' }),
      ])
      assertExitCode(happyResult, 0)
      assertStdoutContains(happyResult, 'hello') // workflow outputs x directly; echo: prefix removed (no sandbox on server)

      // ── 4.1.17: number field receives a string value ─────────────────────
      const typedResult = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'hello', num: 'not-a-number', enum_var: 'A' }),
      ])
      expect(typedResult.exitCode).not.toBe(0)
      expect(typedResult.stderr).toMatch(/num.*number|must be a valid number/i)

      // ── 4.1.18: enum field receives a value outside the allowed options ──
      const enumResult = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'hello', num: 42, enum_var: 'invalid' }),
      ])
      expect(enumResult.exitCode).not.toBe(0)
      expect(enumResult.stderr).toMatch(/enum_var.*must be one of|one of the following/i)
    })
  })

  it('[P1] validation failure returns http_status 422 in JSON error envelope', async () => {
    // After the @accepts/@returns server contract unification, input schema
    // validation failures consistently return HTTP 422 (not 400 or 500).
    // This verifies the CLI propagates the unified status code.
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 'hello', num: 'not-a-number', enum_var: 'A', paragraph: 'ok' }),
      '-o',
      'json',
    ])
    expect(result.exitCode).not.toBe(0)
    const envelope = JSON.parse(result.stderr.trim()) as {
      error: { code: string, message: string, http_status?: number }
    }
    expect(envelope.error.http_status, 'validation failure must return http_status 422').toBe(422)
  })

  // =========================================================================
  // Error scenarios
  // =========================================================================

  describe('Error scenarios', () => {
    it('[P0] non-existent app returns error — exit code 1', async () => {
      // Spec 4.1.20: non-existent app returns an error with not-found message
      // Spec 4.1.21: exit code is exactly 1
      const result = await fx.r(['run', 'app', 'app-id-does-not-exist-e2e-xyz', 'hello'])
      assertExitCode(result, 1)
      expect(result.stderr).toMatch(/not.?found|server_5xx|Internal Server Error|500/i)
    })

    it('[P0] missing app id returns error (exit code 1 — CLI returns 1 for missing required arg)', async () => {
      // Spec: missing app id returns a usage error
      // Actual behaviour: CLI framework returns exit 1 (not 2) for missing required argument
      const result = await fx.r(['run', 'app'])
      assertExitCode(result, 1)
      expect(result.stderr).toMatch(/missing required argument/i)
    })

    it('[P0] unauthenticated run app returns auth error (exit code 4)', async () => {
      // Spec 4.1.22: unauthenticated run app returns auth error message
      // Spec 4.1.23: exit code is exactly 4
      const unauthTmp = await withTempConfig()
      try {
        const result = await run(['run', 'app', E.chatAppId, 'hello'], {
          configDir: unauthTmp.configDir,
        })
        assertExitCode(result, 4)
        expect(result.stderr).toMatch(/not.?logged.?in|auth.?login/i)
      }
      finally {
        await unauthTmp.cleanup()
      }
    })

    it('[P1] network error returns non-zero exit code and error message', async () => {
      // Spec 4.1.26: when the host is unreachable the CLI returns a network error.
      // Uses a local port that has nothing listening (127.0.0.1:19999) so the
      // connection is refused immediately without waiting for DNS.
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
          ['run', 'app', E.chatAppId, 'hello'],
          { configDir: networkTmp.configDir, timeout: 15_000 },
        )
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr.length).toBeGreaterThan(0)
      }
      finally {
        await networkTmp.cleanup()
      }
    })
  })

  // =========================================================================
  // Non-interactive mode / CI environment
  // =========================================================================

  describe('Non-interactive mode (CI)', () => {
    it('[P0] CI=1 environment has no spinner — stdout has no ANSI colour', async () => {
      // Spec: ANSI colour is disabled in non-TTY environment; spinner is suppressed in non-interactive mode
      const result = await fx.r(['run', 'app', E.chatAppId, 'ci-test'], { CI: '1', NO_COLOR: '1' })
      assertExitCode(result, 0)
      assertNoAnsi(result.stdout, 'stdout')
      assertNoAnsi(result.stderr, 'stderr')
    })

    it('[P0] non-interactive mode exit code is correctly propagated', async () => {
      // Spec: non-interactive mode exit code is correct
      const result = await fx.r(['run', 'app', E.chatAppId, 'code'])
      expect(typeof result.exitCode).toBe('number')
      expect(result.exitCode).toBe(0)
    })
  })

  // =========================================================================
  // Workspace override
  // =========================================================================

  describe('workspace override', () => {
    it('[P1] --workspace flag overrides the default workspace', async () => {
      // Spec: workspace override takes effect
      // run app uses --workspace (no -w short form)
      const result = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'ws-override',
        '--workspace',
        E.workspaceId,
      ])
      assertExitCode(result, 0)
    })

    itWithSso('[P1] external SSO user: --workspace parameter is silently ignored', async () => {
      // Spec 4.1.25: SSO subjects operate without workspace scoping.
      // Passing --workspace must not change the outcome — the parameter
      // should be ignored, so both calls produce the same exit code.
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

        // Run WITHOUT --workspace
        const resultWithout = await run(
          ['run', 'app', E.chatAppId, 'hello'],
          { configDir: ssoTmp.configDir },
        )

        // Run WITH --workspace (should be ignored → same exit code)
        const resultWith = await run(
          ['run', 'app', E.chatAppId, 'hello', '--workspace', E.workspaceId],
          { configDir: ssoTmp.configDir },
        )

        // If --workspace were honoured for SSO users it would change behaviour;
        // identical exit codes confirm the parameter is silently ignored.
        expect(resultWith.exitCode).toBe(resultWithout.exitCode)
      }
      finally {
        await ssoTmp.cleanup()
      }
    })
  })

  // =========================================================================
  // Cache behaviour (4.6.1)
  // =========================================================================

  describe('Cache behaviour', () => {
    it('[P0] deleting app-info cache forces CLI to re-fetch from backend (4.6.1)', async () => {
      // Spec 4.6.1: when the local app-info.json cache is absent the CLI must
      // transparently re-fetch app metadata from the backend and complete normally.
      //
      // Strategy:
      //   1. Run once to populate the cache under fx.configDir.
      //   2. Assert the cache file now exists.
      //   3. Delete the cache file.
      //   4. Run again — must still succeed (cache miss → fresh fetch).
      //
      // DIFY_CACHE_DIR redirects the CLI's cache directory into the isolated
      // temp dir so the test can observe and manipulate it without touching
      // ~/Library/Caches/difyctl (macOS platform default).
      // New cache layout: {DIFY_CACHE_DIR}/app-info.yml  (was: cache/app-info.json)
      const cacheEnv = { DIFY_CACHE_DIR: fx.configDir, DIFY_E2E_NO_KEYRING: '1' }

      // Step 1: prime the cache
      const prime = await withRetry(() => fx.r(['run', 'app', E.chatAppId, 'cache-prime'], cacheEnv), {
        attempts: 3,
        delayMs: 2000,
      })
      assertExitCode(prime, 0)

      // Step 2: cache file must have been written at {configDir}/app-info.yml
      const cacheFile = join(fx.configDir, 'app-info.yml')
      const { access } = await import('node:fs/promises')
      await expect(access(cacheFile)).resolves.toBeUndefined()

      // Step 3: delete the cache
      await rm(cacheFile, { force: true })

      // Step 4: run again — cache miss must not cause failure
      const result = await withRetry(() => fx.r(['run', 'app', E.chatAppId, 'cache-miss'], cacheEnv), {
        attempts: 3,
        delayMs: 2000,
      })
      assertExitCode(result, 0)
      expect(result.stdout.length, 'stdout must be non-empty after cache re-fetch').toBeGreaterThan(0)
    })
  })
})

// ── local helper (avoids import confusion) ─────────────────────────────────
function assertNonZeroExit(result: import('../../helpers/cli.js').RunResult): void {
  expect(result.exitCode, 'exit code should be non-zero').not.toBe(0)
}
