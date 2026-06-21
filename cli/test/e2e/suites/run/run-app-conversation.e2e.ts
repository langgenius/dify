/**
 * E2E: difyctl run app --conversation — Conversation mode
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Run/Conversation Mode (24 cases)
 * Cases migrated from: run-app-basic.e2e.ts (Conversation mode describe block)
 *
 * Prerequisites (DIFY_E2E_* env vars):
 *   DIFY_E2E_CHAT_APP_ID — echo-chat app, mode=chat, outputs "echo: {query}"
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertPipeFriendlyJson,
  assertStderrContains,
} from '../../helpers/assert.js'
import { registerConversation } from '../../helpers/cleanup-registry.js'
import { injectAuth, run, spawn_background, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)
const itWithSso = optionalIt(Boolean(E.ssoToken))

describe('E2E / difyctl run app --conversation', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Create & reuse ──────────────────────────────────────────────────────

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
    // Spec 4.3.5: omitting --conversation creates a brand-new session each time;
    // the new conversation_id must be non-empty and distinct from the previous one.
    // withRetry: echo-chat app may return empty answer on back-to-back calls under load.
    const firstId = await withRetry(async () => {
      const r = await fx.r(['run', 'app', E.chatAppId, 'new-conv-1', '-o', 'json'])
      assertExitCode(r, 0)
      const { conversation_id } = assertJson<{ conversation_id: string }>(r)
      expect(conversation_id, 'first call must return a non-empty conversation_id').toBeTruthy()
      return conversation_id
    }, { attempts: 3, delayMs: 2000 })

    const secondId = await withRetry(async () => {
      const r = await fx.r(['run', 'app', E.chatAppId, 'new-conv-2', '-o', 'json'])
      assertExitCode(r, 0)
      const { conversation_id } = assertJson<{ conversation_id: string }>(r)
      expect(conversation_id, 'second call must return a non-empty conversation_id').toBeTruthy()
      return conversation_id
    }, { attempts: 3, delayMs: 2000 })

    expect(secondId, 'omitting --conversation must create a new session, not reuse the previous one')
      .not
      .toBe(firstId)
  })

  // ── Error scenarios ─────────────────────────────────────────────────────

  it('[P0] invalid conversation_id returns error (exit code 1)', async () => {
    // Spec 4.3.9: passing a non-existent conversation_id should return a
    // "conversation not found" error with exit code exactly 1.
    const result = await fx.r([
      'run',
      'app',
      E.chatAppId,
      'bad-conv',
      '--conversation',
      'invalid-conv-id-xyz-not-exist',
    ])
    assertExitCode(result, 1)
    expect(result.stderr).toMatch(/not.?found|conversation|404|422|validation/i)
  })

  // ── Combined flags ──────────────────────────────────────────────────────

  it('[P1] conversation mode supports streaming', async () => {
    // Spec 4.3.6: --conversation <cid> --stream should work and the streaming
    // reply must carry the same conversation_id as the one used in the request.
    // withRetry: echo-chat may return empty answer (no conversation_id) under load.
    await withRetry(async () => {
      const first = await fx.r(['run', 'app', E.chatAppId, 'init', '-o', 'json'])
      assertExitCode(first, 0)
      const { conversation_id } = assertJson<{ conversation_id: string }>(first)
      expect(conversation_id, 'first call should return a conversation_id').toBeTruthy()

      const result = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'continue',
        '--conversation',
        conversation_id,
        '--stream',
        '-o',
        'json',
      ])
      assertExitCode(result, 0)
      const streamed = assertJson<{ conversation_id?: string, answer?: string }>(result)
      expect(streamed.conversation_id, 'streaming reply must carry the same conversation_id')
        .toBe(conversation_id)
    }, { attempts: 3, delayMs: 2000 })
  })

  it('[P1] conversation output supports piping (-o json pipe-friendly format)', async () => {
    // Spec: conversation output supports piping
    const result = await fx.r(['run', 'app', E.chatAppId, 'pipe-conv', '-o', 'json'])
    assertExitCode(result, 0)
    assertPipeFriendlyJson(result)
  })

  // ── Auth error scenarios ────────────────────────────────────────────────

  it('[P0] unauthenticated conversation run returns auth error (exit code 4)', async () => {
    // Spec 4.3.16: running --conversation without a valid session must return
    // an authentication error with exit code exactly 4.
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(
        ['run', 'app', E.chatAppId, 'hello', '--conversation', 'any-conv-id'],
        { configDir: unauthTmp.configDir },
      )
      assertExitCode(result, 4)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  itWithSso('[P0] SSO (dfoe_) token can run conversation mode (exit code 0)', async () => {
    // Spec 4.3.17: an external SSO token (dfoe_) must be able to start a new
    // conversation and receive a valid response; exit code must be 0.
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
        () => run(['run', 'app', E.chatAppId, 'sso-conv-test', '-o', 'json'], {
          configDir: ssoTmp.configDir,
        }),
        { attempts: 3, delayMs: 2000 },
      )
      assertExitCode(result, 0)
      const parsed = assertJson<{ conversation_id?: string }>(result)
      expect(parsed.conversation_id, 'SSO conversation run should return a conversation_id').toBeTruthy()
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  // ── P1 additions ────────────────────────────────────────────────────────

  it('[P1] JSON output includes message_id field', async () => {
    // Spec 4.3.15: -o json response must include a non-empty message_id field.
    const result = await withRetry(async () => {
      const r = await fx.r(['run', 'app', E.chatAppId, 'msg-id-check', '-o', 'json'])
      assertExitCode(r, 0)
      const parsed = assertJson<{ message_id?: string }>(r)
      expect(parsed.message_id, 'message_id must be non-empty').toBeTruthy()
      return r
    }, { attempts: 3, delayMs: 2000 })
    assertExitCode(result, 0)
  })

  it('[P1] after streaming interruption the same conversation_id remains usable', async () => {
    // Spec 4.3.18: interrupting a streaming run must not corrupt the conversation;
    // a subsequent non-streaming call with the same conversation_id must succeed.
    const conversation_id = await withRetry(async () => {
      const r = await fx.r(['run', 'app', E.chatAppId, 'pre-interrupt', '-o', 'json'])
      assertExitCode(r, 0)
      const { conversation_id: cid } = assertJson<{ conversation_id: string }>(r)
      expect(cid, 'setup call must return a conversation_id').toBeTruthy()
      return cid
    }, { attempts: 3, delayMs: 2000 })

    // Start a streaming run and interrupt it after 800 ms.
    const proc = spawn_background(
      ['run', 'app', E.chatAppId, 'streaming-msg', '--conversation', conversation_id, '--stream'],
      { configDir: fx.configDir },
    )
    await new Promise(res => setTimeout(res, 800))
    proc.interrupt()
    await proc.wait()

    // The conversation must still be usable after the interruption.
    const resume = await withRetry(
      () => fx.r([
        'run',
        'app',
        E.chatAppId,
        'after-interrupt',
        '--conversation',
        conversation_id,
        '-o',
        'json',
      ]),
      { attempts: 3, delayMs: 2000 },
    )
    assertExitCode(resume, 0)
    const parsed = assertJson<{ conversation_id: string }>(resume)
    expect(parsed.conversation_id, 'resumed call must carry the same conversation_id')
      .toBe(conversation_id)
  })

  it('[P1] conversation run with unreachable host returns network error (exit non-zero)', async () => {
    // Spec 4.3.19: when the configured host is unreachable, the CLI must return
    // a network error with a non-zero exit code.
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
        ['run', 'app', E.chatAppId, 'hello', '--conversation', 'any-conv-id'],
        { configDir: networkTmp.configDir, timeout: 15_000 },
      )
      expect(result.exitCode, 'unreachable host should cause non-zero exit').not.toBe(0)
      expect(result.stderr.length, 'stderr should contain an error message').toBeGreaterThan(0)
    }
    finally {
      await networkTmp.cleanup()
    }
  })

  it('[P1] invalid conversation_id with -o json outputs JSON error envelope on stderr', async () => {
    // Spec 4.3.22: when conversation_id is invalid and -o json is active,
    // stderr must contain a valid JSON error envelope.
    const result = await fx.r([
      'run',
      'app',
      E.chatAppId,
      'bad-conv-json',
      '--conversation',
      'nonexistent-conv-id-json-e2e',
      '-o',
      'json',
    ])
    expect(result.exitCode, 'invalid conversation in json mode should exit non-zero').not.toBe(0)
    assertErrorEnvelope(result)
  })

  it('[P1] passing --conversation to a workflow app does not crash (stable fallback)', async () => {
    // Spec 4.3.23: workflow apps do not support conversations; the CLI must not
    // crash. The server silently ignores the parameter and runs the workflow normally.
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 'conv-wf-test', num: 1, enum_var: 'A', paragraph: 'ok' }),
      '--conversation',
      'any-conv-id-for-wf',
    ])
    expect(result.exitCode, '--conversation on workflow must not cause an unhandled crash (exit 2)').not.toBe(2)
    expect(result.stderr).not.toMatch(/unhandled|uncaught|TypeError|ReferenceError/i)
  })

  it('[P1] same conversation_id remains stable across 3 consecutive calls', async () => {
    // Spec 4.3.24: reusing the same conversation_id multiple times must always
    // succeed; each call must exit 0 and return the same conversation_id.
    const conversation_id = await withRetry(async () => {
      const r = await fx.r(['run', 'app', E.chatAppId, 'stable-1', '-o', 'json'])
      assertExitCode(r, 0)
      const { conversation_id: cid } = assertJson<{ conversation_id: string }>(r)
      expect(cid, 'initial call must return a conversation_id').toBeTruthy()
      return cid
    }, { attempts: 3, delayMs: 2000 })

    for (let i = 2; i <= 3; i++) {
      const result = await withRetry(
        () => fx.r([
          'run',
          'app',
          E.chatAppId,
          `stable-${i}`,
          '--conversation',
          conversation_id,
          '-o',
          'json',
        ]),
        { attempts: 3, delayMs: 2000 },
      )
      assertExitCode(result, 0)
      const parsed = assertJson<{ conversation_id: string }>(result)
      expect(parsed.conversation_id, `call ${i}: conversation_id must be stable`).toBe(conversation_id)
    }
  })

  // ── 4.3.7  --conversation + --file ──────────────────────────────────────────
  //
  // Prerequisite: DIFY_E2E_FILE_CHAT_APP_ID must be set in .env.e2e.
  // The fixture app is an advanced-chat app with a required file input variable
  // named "file_input" (document type, remote-URL upload supported).
  // We use a remote PDF URL to avoid SSL certificate issues with local upload
  // on the staging server.

  const itWithFileChat = optionalIt(Boolean(E.fileChatAppId))

  itWithFileChat('[P1] --conversation + --file doc uploads a file and continues the conversation', async () => {
    // Spec 4.3.7: --conversation <cid> --file doc=@test.txt
    // File upload succeeds, app executes correctly, conversation_id is preserved.
    const FILE_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'

    // Step 1: Start a new conversation with a file — get the conversation_id.
    const first = await fx.r([
      'run',
      'app',
      E.fileChatAppId,
      'summarize this document',
      '--file',
      `file_input=${FILE_URL}`,
      '-o',
      'json',
    ])
    assertExitCode(first, 0)
    const { conversation_id } = assertJson<{ conversation_id: string }>(first)
    expect(conversation_id, 'first call must return a non-empty conversation_id').toBeTruthy()
    registerConversation(E.host, E.token, E.fileChatAppId, conversation_id)

    // Step 2: Continue the same conversation with another file upload.
    const second = await fx.r([
      'run',
      'app',
      E.fileChatAppId,
      'what is this document about?',
      '--conversation',
      conversation_id,
      '--file',
      `file_input=${FILE_URL}`,
      '-o',
      'json',
    ])
    assertExitCode(second, 0)
    const secondParsed = assertJson<{ conversation_id: string }>(second)

    // The conversation_id must be the same across both calls.
    expect(secondParsed.conversation_id, '--conversation must preserve the conversation_id')
      .toBe(conversation_id)
  })

  // ── 4.3.8  --conversation + --inputs ────────────────────────────────────────
  //
  // The echo-chat app (E.chatAppId) now has an optional text-input variable
  // named "input" (maxLength 256, required: false).  This allows 4.3.8 to be
  // tested against the existing fixture without a separate app.
  //
  // Spec: --conversation <cid> --inputs '{"key":"val"}' — input takes effect,
  // app executes correctly, and conversation_id is preserved across calls.

  it('[P1] --conversation + --inputs passes input variables and preserves conversation_id', async () => {
    // Spec 4.3.8: combining --conversation with --inputs should work correctly.
    // Step 1: start a new conversation with an explicit input variable.
    const first = await fx.r([
      'run',
      'app',
      E.chatAppId,
      'hello with inputs',
      '--inputs',
      JSON.stringify({ input: 'context-value' }),
      '-o',
      'json',
    ])
    assertExitCode(first, 0)
    const { conversation_id } = assertJson<{ conversation_id: string }>(first)
    expect(conversation_id, 'first call must return a non-empty conversation_id').toBeTruthy()
    registerConversation(E.host, E.token, E.chatAppId, conversation_id)

    // Step 2: continue the conversation with another --inputs payload.
    const second = await fx.r([
      'run',
      'app',
      E.chatAppId,
      'follow-up with inputs',
      '--conversation',
      conversation_id,
      '--inputs',
      JSON.stringify({ input: 'updated-context-value' }),
      '-o',
      'json',
    ])
    assertExitCode(second, 0)
    const secondParsed = assertJson<{ conversation_id: string }>(second)

    // The conversation_id must be identical across both calls.
    expect(secondParsed.conversation_id, '--inputs must not break conversation continuity')
      .toBe(conversation_id)
  })

  // ── 4.3.11  wrong app id + valid conversation_id ─────────────────────────────
  //
  // Prerequisite: DIFY_E2E_FILE_CHAT_APP_ID must be set.
  // Scenario (Plan A):
  //   1. Create a conversation using E.chatAppId → get conv_id (owned by chatApp).
  //   2. Run E.fileChatAppId with that conv_id  → server rejects because the
  //      conversation does not belong to fileChatApp (HTTP 500, exit 1).
  //
  // Note: the server returns a 500 / "stream terminated by error event" rather than
  // a 404 "not found", because the conversation lookup is done inside the streaming
  // pipeline.  The important contract is: exit code is 1 (non-zero) and stderr is
  // non-empty with a recognisable error code.

  itWithFileChat('[P0] running fileChatApp with a conversation_id owned by chatApp returns an error (exit 1)', async () => {
    // Spec 4.3.11: using the wrong app id with a valid conversation_id from another
    // app must fail with a non-zero exit code.

    // Step 1: create a conversation with chatApp.
    const setup = await fx.r(['run', 'app', E.chatAppId, 'init-for-cross-app', '-o', 'json'])
    assertExitCode(setup, 0)
    const { conversation_id } = assertJson<{ conversation_id: string }>(setup)
    expect(conversation_id, 'setup call must return a conversation_id').toBeTruthy()
    registerConversation(E.host, E.token, E.chatAppId, conversation_id)

    // Step 2: attempt to continue that conversation using fileChatApp.
    // The server rejects it because the conversation belongs to a different app.
    const result = await fx.r([
      'run',
      'app',
      E.fileChatAppId,
      'this should fail',
      '--conversation',
      conversation_id,
      '-o',
      'json',
    ])

    // The server returns HTTP 500 (stream terminated by error event) with exit 1.
    expect(result.exitCode, 'cross-app conversation_id must cause a non-zero exit').toBe(1)
    expect(result.stderr.trim().length, 'stderr must contain an error message').toBeGreaterThan(0)
    // stderr must be a JSON error envelope when -o json is active
    assertErrorEnvelope(result)
  })
})
