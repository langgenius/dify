/**
 * E2E: Agent-via-Skill Workflow
 *
 * Scenario: an AI agent has loaded difyctl SKILL.md and drives difyctl to:
 *   1. Bootstrap  - read SKILL.md via `skills install --stdout`
 *   2. Discover   - `help -o json` for full command surface + contract
 *   3. Auth check - no token → exit 4 + JSON error envelope
 *   4. Discover apps    - `get app -o json`
 *   5. Describe app     - `describe app <id> -o json`
 *   6. Run app          - `run app <id> -o json`
 *   7. Error handling   - JSON envelope on stderr, branch on error.code
 *   8. HITL             - paused JSON payload
 *   9. Effect guard     - check effect before write/destructive actions
 *  10. Pipeline safety  - no ANSI/spinner, stdout/stderr separation
 *
 * PRD: §3 Agent-Driven, §5 Agent onboarding, Req 1.3/2.1/2.3/3.1-3.3
 * Agent Skills PRD: §4/§5.2 SKILL.md → help -o json discovery pattern
 *
 * Groups 1-3, 9: no auth required (local mode compatible)
 * Groups 4-8, 10: require DIFY_E2E_TOKEN / staging — wrapped with optionalIt
 */

import type { AuthFixture, RunResult } from '../../helpers/cli.js'
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

// @ts-expect-error injected by vitest global-setup
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

const itWithAuth = optionalIt(Boolean(E.token))
const itWithSso = optionalIt(Boolean(E.ssoToken))
const itWithChat = optionalIt(Boolean(E.token) && Boolean(E.chatAppId))
const itWithWorkflow = optionalIt(Boolean(E.token) && Boolean(E.workflowAppId))
const itWithHitl = optionalIt(Boolean(E.token) && Boolean(E.hitlAppId))

// ---------------------------------------------------------------------------
// 1 + 2. Skill bootstrap → help -o json discovery
// ---------------------------------------------------------------------------

describe('E2E / agent skill — bootstrap + discovery (no auth)', () => {
  it('[P0] SKILL.md contains `difyctl help -o json` as the discovery entry point', async () => {
    const r = await run(['skills', 'install', '--stdout'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('difyctl help -o json')
  })

  it('[P0] SKILL.md enumerates no commands from the tree (zero drift surface)', async () => {
    const helpR = await run(['help', '-o', 'json'])
    expect(helpR.exitCode).toBe(0)
    const { commands } = JSON.parse(helpR.stdout) as { commands: Array<{ command: string }> }
    const skillR = await run(['skills', 'install', '--stdout'])
    expect(skillR.exitCode).toBe(0)
    const ALLOWED = new Set(['resume app', 'skills install', 'version'])
    for (const { command } of commands) {
      if (ALLOWED.has(command)) continue
      expect(skillR.stdout, `skill must not enumerate "${command}"`).not.toContain(command)
    }
  })

  it('[P0] SKILL.md explains HITL pause is not a crash', async () => {
    const r = await run(['skills', 'install', '--stdout'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/paused/i)
    expect(r.stdout).toMatch(/not a (crash|failure)/i)
  })

  it('[P0] SKILL.md version stamp matches `difyctl version`', async () => {
    const skillR = await run(['skills', 'install', '--stdout'])
    const verR = await run(['version'])
    expect(skillR.exitCode).toBe(0)
    expect(verR.exitCode).toBe(0)
    const m = skillR.stdout.match(/difyctl skill v([.\w-]+)/)
    expect(m).not.toBeNull()
    expect(verR.stdout).toContain(m![1])
  })

  it('[P0] `help -o json` sitemap has bin, contract, commands, topics', async () => {
    const r = await run(['help', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    const map = JSON.parse(r.stdout)
    expect(map.bin).toBe('difyctl')
    expect(map.contract.exitCodes['0']).toMatch(/success/i)
    expect(map.contract.exitCodes['2']).toBeDefined()
    expect(map.contract.exitCodes['4']).toBeDefined()
    expect(map.contract.errorEnvelope.shape).toContain('hint')
    expect(map.contract.hitl.resume).toContain('difyctl resume app')
    expect(Array.isArray(map.commands)).toBe(true)
    expect(map.commands.every((c: { effect?: unknown }) => typeof c.effect === 'string')).toBe(true)
    expect(map.topics.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(['account', 'agent', 'environment', 'external']),
    )
  })

  it('[P0] every command in help -o json has args, flags, examples arrays', async () => {
    const { commands } = JSON.parse((await run(['help', '-o', 'json'])).stdout) as {
      commands: Array<{ command: string; args: unknown; flags: unknown; examples: unknown }>
    }
    for (const cmd of commands) {
      expect(Array.isArray(cmd.args), `${cmd.command}.args`).toBe(true)
      expect(Array.isArray(cmd.flags), `${cmd.command}.flags`).toBe(true)
      expect(Array.isArray(cmd.examples), `${cmd.command}.examples`).toBe(true)
    }
  })

  it('[P0] `help -o json` stdout is pipe-safe (no ANSI, starts with {, ends with newline)', async () => {
    const r = await run(['help', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    assertNoAnsi(r.stdout, 'help -o json stdout')
    assertPipeFriendlyJson(r)
  })

  it('[P0] per-command: `help run app -o json` has agentGuide and effect=write', async () => {
    const r = await run(['help', 'run', 'app', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    const d = JSON.parse(r.stdout)
    expect(d.command).toBe('run app')
    expect(d.effect).toBe('write')
    expect(typeof d.agentGuide).toBe('string')
    expect((d.agentGuide as string).length).toBeGreaterThan(0)
  })

  it('[P0] per-command: `help auth login -o json` agentGuide mentions DIFY_TOKEN', async () => {
    const r = await run(['help', 'auth', 'login', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).agentGuide).toMatch(/DIFY_TOKEN|non-interactive/i)
  })

  it('[P1] effect=read for get app, describe app', async () => {
    for (const cmd of [
      ['help', 'get', 'app', '-o', 'json'],
      ['help', 'describe', 'app', '-o', 'json'],
    ]) {
      const r = await run(cmd)
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout).effect).toBe('read')
    }
  })

  it('[P1] effect=destructive for auth devices revoke', async () => {
    const r = await run(['help', 'auth', 'devices', 'revoke', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).effect).toBe('destructive')
  })

  it('[P1] `help agent` covers DISCOVERY, AUTH, EXIT CODES, ERRORS, HUMAN-IN-THE-LOOP, RETRY', async () => {
    const r = await run(['help', 'agent'])
    expect(r.exitCode).toBe(0)
    for (const section of [
      'DISCOVERY',
      'AUTH',
      'EXIT CODES',
      'ERRORS',
      'HUMAN-IN-THE-LOOP',
      'RETRY',
    ])
      expect(r.stdout, `missing section: ${section}`).toContain(section)
  })
})

// ---------------------------------------------------------------------------
// 3. Auth check — no token → exit 4 + JSON error envelope
// ---------------------------------------------------------------------------

describe('E2E / agent skill — auth error handling (no token)', () => {
  it('[P0] no token → exit 4 (auth error, not exit 1 or 2)', async () => {
    const tc = await withTempConfig()
    try {
      const r = await run(['get', 'app', '-o', 'json'], { configDir: tc.configDir })
      expect(r.exitCode).toBe(4)
    } finally {
      await tc.cleanup()
    }
  })

  it('[P0] no token + -o json → stderr is parseable JSON error envelope', async () => {
    const tc = await withTempConfig()
    try {
      const r = await run(['get', 'app', '-o', 'json'], { configDir: tc.configDir })
      assertErrorEnvelope(r)
    } finally {
      await tc.cleanup()
    }
  })

  it('[P0] error envelope has hint field pointing to recovery action', async () => {
    const tc = await withTempConfig()
    try {
      const r = await run(['get', 'app', '-o', 'json'], { configDir: tc.configDir })
      const env = assertErrorEnvelope(r)
      expect(typeof env.error.hint).toBe('string')
      expect(env.error.hint!.length).toBeGreaterThan(0)
      expect(env.error.hint).toMatch(/auth login|DIFY_TOKEN/i)
    } finally {
      await tc.cleanup()
    }
  })

  it('[P0] no token → stdout is empty (error only on stderr)', async () => {
    const tc = await withTempConfig()
    try {
      const r = await run(['get', 'app', '-o', 'json'], { configDir: tc.configDir })
      expect(r.stdout.trim()).toBe('')
    } finally {
      await tc.cleanup()
    }
  })

  it('[P1] usage error (bad flag) → non-zero exit, not exit 4 (agent can distinguish auth vs usage)', async () => {
    // CLI returns exit 1 for unknown flags (not exit 2 as PRD specifies).
    // Known deviation: CLI framework does not differentiate usage errors vs generic errors here.
    // Agent contract: exit != 0 AND exit != 4 → not an auth error, can diagnose flag issue.
    const tc = await withTempConfig()
    try {
      const r = await run(['get', 'app', '--unknown-flag-xyz-e2e'], { configDir: tc.configDir })
      expect(r.exitCode).not.toBe(0)
      expect(r.exitCode).not.toBe(4)
    } finally {
      await tc.cleanup()
    }
  })

  it('[P1] stderr is pure JSON on auth error — entire trim() parses as JSON', async () => {
    const tc = await withTempConfig()
    try {
      const r = await run(['get', 'app', '-o', 'json'], { configDir: tc.configDir })
      expect(() => JSON.parse(r.stderr.trim())).not.toThrow()
    } finally {
      await tc.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// 4. get app -o json — app discovery
// ---------------------------------------------------------------------------

describe('E2E / agent skill — get app -o json (auth required)', () => {
  let fx: AuthFixture
  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  itWithAuth('[P0] exits 0 and stdout is parseable JSON', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(r, 0)
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })

  itWithAuth('[P0] result is array or {data:[]} — agent can iterate app list', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(r, 0)
    const p = assertJson<unknown>(r)
    const isIterable =
      Array.isArray(p) ||
      (typeof p === 'object' && p !== null && Array.isArray((p as Record<string, unknown>).data))
    expect(isIterable).toBe(true)
  })

  itWithAuth('[P0] stdout has no ANSI — safe to pipe through jq', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(r, 0)
    assertNoAnsi(r.stdout, 'stdout')
    assertPipeFriendlyJson(r)
  })

  itWithAuth('[P0] stderr is empty on success', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(r, 0)
    expect(r.stderr.trim()).toBe('')
  })

  itWithAuth('[P1] each app entry has id and mode (agent needs these for run app)', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(r, 0)
    const p = assertJson<unknown>(r)
    const items = Array.isArray(p) ? p : ((p as Record<string, unknown>).data as unknown[])
    if ((items as unknown[]).length > 0) {
      const first = (items as Record<string, unknown>[])[0]!
      expect(first).toHaveProperty('id')
      expect(first).toHaveProperty('mode')
    }
  })

  itWithAuth('[P1] -o name gives one id per line for xargs pipeline', async () => {
    const r = await fx.r(['get', 'app', '-o', 'name'])
    assertExitCode(r, 0)
    assertNoAnsi(r.stdout, 'stdout')
    const lines = r.stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0)
    for (const line of lines) expect(line.trim()).not.toMatch(/\s/)
  })

  itWithSso('[P0] [SSO] dfoe_ get app -o json → permitted-apps list envelope', async () => {
    const tc = await withTempConfig()
    try {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      await mkdir(tc.configDir, { recursive: true })
      await writeFile(
        join(tc.configDir, 'hosts.yml'),
        `${[
          `current_host: ${E.host}`,
          'token_storage: file',
          'tokens:',
          `  bearer: ${E.ssoToken}`,
          'external_subject:',
          '  email: sso@example.com',
          '  issuer: https://issuer.example.com',
        ].join('\n')}\n`,
        { mode: 0o600 },
      )
      const r = await run(['get', 'app', '-o', 'json'], { configDir: tc.configDir })
      assertExitCode(r, 0)
      const parsed = assertJson<{ data: unknown[] }>(r)
      expect(Array.isArray(parsed.data), 'permitted-apps envelope has a data array').toBe(true)
    } finally {
      await tc.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// 5. describe app -o json — parameter schema
// ---------------------------------------------------------------------------

describe('E2E / agent skill — describe app -o json (auth required)', () => {
  let fx: AuthFixture
  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  itWithChat('[P0] exits 0 and stdout is parseable JSON', async () => {
    const r = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(r, 0)
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })

  itWithChat('[P0] response has mode field — agent selects run strategy', async () => {
    const r = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(r, 0)
    const desc = assertJson<Record<string, unknown>>(r)
    // describe app wraps mode under info: { info: { mode, name, ... }, parameters, input_schema }
    expect(desc.info as Record<string, unknown>).toHaveProperty('mode')
  })

  itWithWorkflow(
    '[P0] workflow app response has input schema — agent reads before run',
    async () => {
      const r = await fx.r(['describe', 'app', E.workflowAppId, '-o', 'json'])
      assertExitCode(r, 0)
      const d = assertJson<Record<string, unknown>>(r)
      const hasSchema = 'user_input_form' in d || 'parameters' in d || 'inputs' in d
      expect(hasSchema, 'describe response must contain input schema').toBe(true)
    },
  )

  itWithChat('[P0] stdout has no ANSI — pipe-safe', async () => {
    const r = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(r, 0)
    assertNoAnsi(r.stdout, 'stdout')
    assertPipeFriendlyJson(r)
  })

  itWithAuth('[P0] invalid (non-UUID) app id → exit 2 + usage error envelope', async () => {
    // 'app-id-nonexistent-e2e-xyz' is not a valid UUID; describe app rejects it
    // client-side via isValidUuid() with usage_invalid_flag (exit 2).
    const r = await fx.r(['describe', 'app', 'app-id-nonexistent-e2e-xyz', '-o', 'json'])
    expect(r.exitCode).toBe(2)
    assertErrorEnvelope(r)
  })
})

// ---------------------------------------------------------------------------
// 6. run app -o json — structured output
// ---------------------------------------------------------------------------

describe('E2E / agent skill — run app -o json (auth required)', () => {
  let fx: AuthFixture
  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  itWithChat('[P0] run chat app -o json → exit 0, valid JSON with answer field', async () => {
    const r = await withRetry(() => fx.r(['run', 'app', E.chatAppId, 'hello', '-o', 'json']), {
      attempts: 5,
      delayMs: 4000,
      shouldRetry: (err) => err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message),
    })
    assertExitCode(r, 0)
    const p = assertJson<Record<string, unknown>>(r)
    expect(p).toHaveProperty('answer')
    expect(typeof p.answer).toBe('string')
  })

  itWithWorkflow('[P0] run workflow -o json → exit 0, JSON contains outputs', async () => {
    const r = await withRetry(
      () =>
        fx.r([
          'run',
          'app',
          E.workflowAppId,
          '--inputs',
          JSON.stringify({ x: 'agent-e2e', num: 1, enum_var: 'A', paragraph: 'ok' }),
          '-o',
          'json',
        ]),
      {
        attempts: 5,
        delayMs: 4000,
        shouldRetry: (err) =>
          err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message),
      },
    )
    assertExitCode(r, 0)
    const p = assertJson<Record<string, unknown>>(r)
    const hasOutputs =
      'outputs' in p ||
      ('data' in p &&
        typeof p.data === 'object' &&
        p.data !== null &&
        'outputs' in (p.data as object))
    expect(hasOutputs, 'workflow -o json must contain outputs').toBe(true)
  })

  itWithChat('[P0] stdout has no ANSI — agent can JSON.parse directly', async () => {
    const r = await withRetry(() => fx.r(['run', 'app', E.chatAppId, 'pipe-test', '-o', 'json']), {
      attempts: 5,
      delayMs: 4000,
      shouldRetry: (err) => err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message),
    })
    assertExitCode(r, 0)
    assertNoAnsi(r.stdout, 'stdout')
    assertPipeFriendlyJson(r)
  })

  itWithChat('[P0] stderr is empty on success', async () => {
    const r = await withRetry(() => fx.r(['run', 'app', E.chatAppId, 'clean-test', '-o', 'json']), {
      attempts: 5,
      delayMs: 4000,
      shouldRetry: (err) => err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message),
    })
    assertExitCode(r, 0)
    expect(r.stderr.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 7. Error handling — agent branches on error.code
// ---------------------------------------------------------------------------

describe('E2E / agent skill — error handling for agent branching (auth required)', () => {
  let fx: AuthFixture
  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  itWithAuth('[P0] nonexistent app → exit 1, stderr JSON envelope, stdout empty', async () => {
    const r = await fx.r(['run', 'app', 'nonexistent-app-id-e2e-xyz', 'hello', '-o', 'json'])
    expect(r.exitCode).toBe(1)
    assertErrorEnvelope(r)
    expect(r.stdout.trim()).toBe('')
  })

  itWithAuth(
    '[P0] error.code is stable across repeated calls (agent can cache branch logic)',
    async () => {
      const r1 = await fx.r(['run', 'app', 'nonexistent-app-id-e2e-xyz', 'hello', '-o', 'json'])
      const r2 = await fx.r(['run', 'app', 'nonexistent-app-id-e2e-xyz', 'hello', '-o', 'json'])
      const e1 = assertErrorEnvelope(r1)
      const e2 = assertErrorEnvelope(r2)
      expect(e1.error.code).toBe(e2.error.code)
    },
  )

  itWithAuth('[P0] entire stderr (trimmed) is parseable JSON — no mixed text prefix', async () => {
    const r = await fx.r(['run', 'app', 'nonexistent-app-id-e2e-xyz', 'hello', '-o', 'json'])
    expect(r.exitCode).not.toBe(0)
    expect(() => JSON.parse(r.stderr.trim())).not.toThrow()
  })

  itWithAuth('[P0] invalid --inputs JSON → exit 2 (usage), stdout empty', async () => {
    const r = await fx.r(['run', 'app', E.chatAppId, '--inputs', 'not-json', '-o', 'json'])
    expect(r.exitCode).toBe(2)
    expect(r.stdout.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 8. HITL — paused JSON + resume pointer
// ---------------------------------------------------------------------------

const HITL_TRANSIENT_RE = /server_5xx|5\d{2}|ECONNRESET|timeout/i

async function runHitlPause(fx: AuthFixture, input: string): Promise<RunResult> {
  return withRetry(
    async () => {
      const result = await fx.r([
        'run',
        'app',
        E.hitlAppId,
        '--inputs',
        JSON.stringify({ x: input }),
        '-o',
        'json',
      ])
      if (result.exitCode !== 0 && HITL_TRANSIENT_RE.test(result.stderr))
        throw new Error(`transient HITL run failure: ${result.stderr.slice(0, 200)}`)
      return result
    },
    {
      attempts: 5,
      delayMs: 4000,
      shouldRetry: (err) => err instanceof Error && HITL_TRANSIENT_RE.test(err.message),
    },
  )
}

describe('E2E / agent skill — HITL pause handling (auth required)', () => {
  let fx: AuthFixture
  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  itWithHitl(
    '[P0] HITL app exits 0 and returns paused payload — agent resumes rather than retries',
    async () => {
      const r = await runHitlPause(fx, 'agent-hitl-exit')
      assertExitCode(r, 0)
    },
  )

  itWithHitl('[P0] HITL stdout contains status:paused JSON payload', async () => {
    const r = await runHitlPause(fx, 'agent-hitl-status')
    assertExitCode(r, 0)
    expect(assertJson<Record<string, unknown>>(r).status).toBe('paused')
  })

  itWithHitl('[P0] HITL payload has form_token + workflow_run_id for resume call', async () => {
    const r = await runHitlPause(fx, 'agent-hitl-token')
    assertExitCode(r, 0)
    const p = assertJson<Record<string, unknown>>(r)
    expect(p).toHaveProperty('form_token')
    expect(p).toHaveProperty('workflow_run_id')
  })
})

// ---------------------------------------------------------------------------
// 9. Effect guard — agent checks before write/destructive (no auth)
// ---------------------------------------------------------------------------

describe('E2E / agent skill — effect guard (no auth)', () => {
  it('[P0] run app effect=write — agent expects state change', async () => {
    const r = await run(['help', 'run', 'app', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).effect).toBe('write')
  })

  it('[P0] auth devices revoke effect=destructive — agent must confirm before calling', async () => {
    const r = await run(['help', 'auth', 'devices', 'revoke', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).effect).toBe('destructive')
  })

  it('[P0] get app and describe app effect=read — agent can call freely', async () => {
    for (const args of [
      ['help', 'get', 'app', '-o', 'json'],
      ['help', 'describe', 'app', '-o', 'json'],
    ]) {
      const r = await run(args)
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout).effect).toBe('read')
    }
  })

  it('[P0] no command in the full tree has undefined/null effect', async () => {
    const { commands } = JSON.parse((await run(['help', '-o', 'json'])).stdout) as {
      commands: Array<{ command: string; effect: unknown }>
    }
    const bad = commands.filter((c) => !c.effect || typeof c.effect !== 'string')
    expect(bad.map((c) => c.command)).toEqual([])
  })

  it('[P1] skills install effect=write', async () => {
    const r = await run(['help', 'skills', 'install', '-o', 'json'])
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout).effect).toBe('write')
  })
})

// ---------------------------------------------------------------------------
// 10. Pipeline safety — -o json is fully pipe-safe (auth required)
// ---------------------------------------------------------------------------

describe('E2E / agent skill — pipeline safety (auth required)', () => {
  let fx: AuthFixture
  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  itWithAuth('[P0] stdout has no ANSI on success under -o json', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(r, 0)
    assertNoAnsi(r.stdout, 'stdout')
  })

  itWithAuth('[P0] stdout is empty on error under -o json (error → stderr only)', async () => {
    const r = await fx.r(['run', 'app', 'nonexistent-e2e-xyz', 'hello', '-o', 'json'])
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout.trim()).toBe('')
    expect(r.stderr.trim().length).toBeGreaterThan(0)
  })

  itWithChat('[P0] stdout is non-empty on success under -o json', async () => {
    const r = await withRetry(
      () => fx.r(['run', 'app', E.chatAppId, 'pipeline-test', '-o', 'json']),
      {
        attempts: 5,
        delayMs: 4000,
        shouldRetry: (err) =>
          err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message),
      },
    )
    assertExitCode(r, 0)
    expect(r.stdout.trim().length).toBeGreaterThan(0)
    expect(r.stderr.trim()).toBe('')
  })

  itWithAuth('[P1] no ANSI on stderr under -o json', async () => {
    const tc = await withTempConfig()
    try {
      const r = await run(['get', 'app', '-o', 'json'], { configDir: tc.configDir })
      assertNoAnsi(r.stderr, 'stderr')
    } finally {
      await tc.cleanup()
    }
  })

  itWithAuth('[P1] stdout ends with newline (POSIX pipe convention)', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(r, 0)
    expect(r.stdout.endsWith('\n')).toBe(true)
  })

  itWithAuth('[P1] CI=1 + NO_COLOR=1 produce no spinner artifacts', async () => {
    const r = await fx.r(['get', 'app', '-o', 'json'], { CI: '1', NO_COLOR: '1' })
    assertExitCode(r, 0)
    assertNoAnsi(r.stdout, 'stdout')
    assertNoAnsi(r.stderr, 'stderr')
    expect(r.stdout).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
  })
})
