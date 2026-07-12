/**
 * E2E: difyctl run app — separated-mode reasoning (PR #37460)
 *
 * Exercises the out-of-band `reasoning_chunk` SSE channel against a real server.
 * Requires a chatflow whose LLM node uses reasoning_format=separated AND a
 * workspace with a configured chat model. The whole suite is skipped unless
 * DIFY_E2E_REASONING_APP_ID resolves (set it directly, or provision the
 * reasoning-chat.yml fixture with DIFY_E2E_REASONING_PROVISION=1).
 *
 * Verifies the client adaptation:
 *  - --think surfaces the separated reasoning to stderr, framed as <think>…</think>
 *  - the answer (stdout) stays free of <think>
 *  - -o json persists the reasoning under metadata.reasoning
 *  - without --think, reasoning stays hidden
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { afterEach, beforeEach, describe, expect, inject } from 'vitest'
import { assertExitCode, assertJson, assertStderrContains } from '../../helpers/assert.js'
import { registerConversation } from '../../helpers/cleanup-registry.js'
import { withAuthFixture } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

// Skipped unless a separated-reasoning chatflow is wired up (needs a real model).
const reasoningIt = optionalIt(Boolean(E.reasoningAppId))

const QUERY = 'In one short sentence, why is the sky blue?'

describe('E2E / difyctl run app — separated reasoning', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  reasoningIt(
    '[P1] --think --stream surfaces reasoning on stderr, clean answer on stdout',
    async () => {
      const result = await withRetry(
        () => fx.r(['run', 'app', E.reasoningAppId, QUERY, '--think', '--stream']),
        { attempts: 3, delayMs: 1000 },
      )

      assertExitCode(result, 0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
      // Separated mode keeps the answer free of <think>; reasoning is framed on stderr.
      expect(result.stdout).not.toContain('<think>')
      assertStderrContains(result, '<think>')
    },
  )

  reasoningIt('[P1] --think -o json persists reasoning under metadata.reasoning', async () => {
    const result = await withRetry(
      () => fx.r(['run', 'app', E.reasoningAppId, QUERY, '--think', '-o', 'json']),
      { attempts: 3, delayMs: 1000 },
    )

    assertExitCode(result, 0)
    const parsed = assertJson<{
      conversation_id?: string
      answer: string
      metadata?: { reasoning?: Record<string, string> }
    }>(result)

    if (parsed.conversation_id)
      registerConversation(E.host, E.token, E.reasoningAppId, parsed.conversation_id)

    const reasoning = parsed.metadata?.reasoning ?? {}
    expect(Object.keys(reasoning).length).toBeGreaterThan(0)
    expect(Object.values(reasoning).join('').length).toBeGreaterThan(0)
    // --think also echoes the separated reasoning to stderr.
    assertStderrContains(result, '<think>')
  })

  reasoningIt('[P1] without --think, reasoning stays hidden', async () => {
    const result = await withRetry(
      () => fx.r(['run', 'app', E.reasoningAppId, QUERY, '--stream']),
      { attempts: 3, delayMs: 1000 },
    )

    assertExitCode(result, 0)
    expect(result.stdout.trim().length).toBeGreaterThan(0)
    expect(result.stderr).not.toContain('<think>')
  })
})
