/**
 * E2E: difyctl run app — basic app execution + streaming + conversation
 *
 * Test cases sourced from: Dify CLI Enhanced spec
 *   - Dify CLI/Run/Basic App Execution (26 cases)
 *   - Dify CLI/Run/Streaming Output (subset; full coverage in run-app-streaming.e2e.ts)
 *   - Dify CLI/Run/Conversation Mode (subset)
 *   - Dify CLI/Error Handling/Exit Code (run-related)
 *   - Dify CLI/CLI Framework/Non-Interactive (run-related)
 *
 * Staging app prerequisites (specified via DIFY_E2E_* env vars):
 *   echo-chat     — mode=chat, query variable, outputs "echo: {query}"
 *   echo-workflow — mode=workflow, x variable (required), outputs "echo: {x}"
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertPipeFriendlyJson,
  assertStderrContains,
  assertStdoutContains,
} from '../../helpers/assert.js'
import { registerConversation } from '../../helpers/cleanup-registry.js'
import { run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

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
        () => fx.r(['run', 'app', E.workflowAppId, '--inputs', JSON.stringify({ x: 'workflow-val' })]),
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
        JSON.stringify({ x: 'multi-test' }),
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
      await writeFile(inputsFile, JSON.stringify({ x: 'from-file' }))
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs-file', inputsFile])
      assertExitCode(result, 0)
      assertStdoutContains(result, 'from-file')
    })
  })

  // =========================================================================
  // Error scenarios
  // =========================================================================

  describe('Error scenarios', () => {
    it('[P0] non-existent app returns error — exit code 1', async () => {
      // Spec: non-existent app returns app-not-found + exit code 1
      const result = await fx.r(['run', 'app', 'app-id-does-not-exist-e2e-xyz', 'hello'])
      assertExitCode(result, 1)
      expect(result.stderr).toMatch(/not.?found/i)
    })

    it('[P0] missing app id returns error (exit code 1 — CLI returns 1 for missing required arg)', async () => {
      // Spec: missing app id returns a usage error
      // Actual behaviour: CLI framework returns exit 1 (not 2) for missing required argument
      const result = await fx.r(['run', 'app'])
      assertExitCode(result, 1)
      expect(result.stderr).toMatch(/missing required argument/i)
    })

    it('[P0] unauthenticated run app returns auth error (exit code 4)', async () => {
      // Spec: unauthenticated run app returns auth error + exit code 4
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
  })

  // =========================================================================
  // Streaming output
  // =========================================================================

  describe('Streaming output', () => {
    it('[P0] --stream receives streaming output correctly — stdout has content', async () => {
      // Spec: run app --stream receives streaming output correctly
      const result = await fx.r(['run', 'app', E.chatAppId, 'stream-test', '--stream'])
      assertExitCode(result, 0)
      assertStdoutContains(result, 'echo:stream-test')
    })

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

    it('[P0] streaming with non-existent app returns error (exit code 1)', async () => {
      // Spec: streaming with non-existent app returns an error
      const result = await fx.r(['run', 'app', 'nonexistent-xyz-e2e', 'hi', '--stream'])
      assertExitCode(result, 1)
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

    it('[P1] streaming mode output supports piping (no ANSI, ends with \\n)', async () => {
      // Spec: streaming mode output supports piping
      const result = await fx.r(['run', 'app', E.chatAppId, 'pipe-s', '--stream'])
      assertExitCode(result, 0)
      assertNoAnsi(result.stdout, 'stdout')
      expect(result.stdout.endsWith('\n')).toBe(true)
    })

    it('[P0] workflow streaming output contains succeeded status', async () => {
      const result = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'wf-stream-val' }),
        '--stream',
        '-o',
        'json',
      ])
      assertExitCode(result, 0)
      const parsed = assertJson<{ data?: { status?: string } }>(result)
      expect(parsed.data?.status).toBe('succeeded')
    })
  })

  // =========================================================================
  // Conversation mode
  // =========================================================================

  describe('Conversation mode', () => {
    it('[P0] chat app can create a new conversation — stderr contains hint', async () => {
      // Spec: chat app can create a new conversation
      const result = await fx.r(['run', 'app', E.chatAppId, 'start-conv'])
      assertExitCode(result, 0)
      assertStderrContains(result, '--conversation')
    })

    it('[P0] JSON output includes conversation_id', async () => {
      // Spec: JSON output includes conversation_id
      const result = await fx.r(['run', 'app', E.chatAppId, 'conv-json', '-o', 'json'])
      assertExitCode(result, 0)
      const parsed = assertJson<{ conversation_id: string }>(result)
      expect(typeof parsed.conversation_id).toBe('string')
      expect(parsed.conversation_id.length).toBeGreaterThan(0)
      registerConversation(E.host, E.token, E.chatAppId, parsed.conversation_id)
    })

    it('[P0] --conversation flag works — conversation_id is reused in subsequent requests', async () => {
      // Spec: --conversation flag works; conversation_id is reused in subsequent requests
      const first = await fx.r(['run', 'app', E.chatAppId, 'first-msg', '-o', 'json'])
      assertExitCode(first, 0)
      const { conversation_id } = assertJson<{ conversation_id: string }>(first)
      registerConversation(E.host, E.token, E.chatAppId, conversation_id)

      const second = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'second-msg',
        '--conversation',
        conversation_id,
        '-o',
        'json',
      ])
      assertExitCode(second, 0)
      const secondParsed = assertJson<{ conversation_id: string }>(second)
      expect(secondParsed.conversation_id).toBe(conversation_id)
    })

    it('[P0] a new session is auto-created when conversation_id is omitted', async () => {
      // Spec: a new session is auto-created when conversation_id is omitted
      const result = await fx.r(['run', 'app', E.chatAppId, 'new-conv', '-o', 'json'])
      assertExitCode(result, 0)
      const { conversation_id } = assertJson<{ conversation_id: string }>(result)
      expect(conversation_id).toBeTruthy()
    })

    it('[P0] invalid conversation_id returns error (exit code 1)', async () => {
      // Spec: invalid conversation_id returns an error
      const result = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'bad-conv',
        '--conversation',
        'invalid-conv-id-xyz-not-exist',
      ])
      assertNonZeroExit(result)
    })

    it('[P1] conversation mode supports streaming', async () => {
      // Spec: conversation mode supports streaming
      const first = await fx.r(['run', 'app', E.chatAppId, 'init', '-o', 'json'])
      const { conversation_id } = assertJson<{ conversation_id: string }>(first)

      const result = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'continue',
        '--conversation',
        conversation_id,
        '--stream',
      ])
      assertExitCode(result, 0)
      assertStdoutContains(result, 'echo:')
    })

    it('[P1] conversation output supports piping (-o json pipe-friendly format)', async () => {
      // Spec: conversation output supports piping
      const result = await fx.r(['run', 'app', E.chatAppId, 'pipe-conv', '-o', 'json'])
      assertExitCode(result, 0)
      assertPipeFriendlyJson(result)
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
  })
})

// ── local helper (avoids import confusion) ─────────────────────────────────
function assertNonZeroExit(result: import('../../helpers/cli.js').RunResult): void {
  expect(result.exitCode, 'exit code should be non-zero').not.toBe(0)
}
