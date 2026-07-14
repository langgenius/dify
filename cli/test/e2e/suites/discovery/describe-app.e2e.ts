/**
 * E2E: difyctl describe app — Describe App
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Discovery/Describe App (29 cases)
 */

import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
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

describe('E2E / difyctl describe app', () => {
  let fx: Awaited<ReturnType<typeof withAuthFixture>>

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── Basic describe ────────────────────────────────────────────────────────

  it('[P0] logged-in user can describe an app', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it('[P0] default text output is labelled-section style', async () => {
    // Spec: default output is kubectl-describe-style labelled sections
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    // Labelled output contains key: value pairs
    expect(result.stdout).toMatch(/\w+:\s+\S/)
  })

  it('[P1] describe output contains ID field', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/ID:/i)
    expect(result.stdout).toContain(E.chatAppId)
  })

  it('[P1] describe output contains Mode field', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Mode:/i)
  })

  it('[P1] describe output contains Name field', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Name:/i)
  })

  // ── Input schema ──────────────────────────────────────────────────────────

  it('[P0] describe output contains Parameters section', async () => {
    // Spec: Inputs/Parameters section present when app has an input schema
    const result = await fx.r(['describe', 'app', E.workflowAppId])
    assertExitCode(result, 0)
    // Workflow app has at least a 'x' required input
    expect(result.stdout).toMatch(/Parameters|Inputs/i)
  })

  // ── JSON output ───────────────────────────────────────────────────────────

  it('[P0] -o json outputs raw describe response with info and parameters (3.78)', async () => {
    // Spec 3.78: -o json → raw describe response containing info + parameters.
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ info: { id: string }; parameters: unknown }>(result)
    expect(parsed.info?.id, 'info.id should match the queried app').toBe(E.chatAppId)
    expect(parsed.parameters, 'parameters field must be present').toBeDefined()
  })

  it('[P1] JSON output is valid indented JSON', async () => {
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(result, 0)
    // Indented JSON: multiple lines, starts with '{'
    expect(result.stdout.trim()).toMatch(/^\{/)
    expect(result.stdout.split('\n').length).toBeGreaterThan(2)
  })

  it('[P1] JSON output can be piped and has no ANSI (3.82)', async () => {
    // Spec 3.82: -o json | jq . works; no ANSI codes.
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
    expect(result.stdout.trimStart().startsWith('{')).toBe(true)
    expect(result.stdout.endsWith('\n')).toBe(true)
  })

  // ── Unsupported formats ───────────────────────────────────────────────────

  it('[P0] -o wide returns NoCompatiblePrinterError (exit non-0) (3.80)', async () => {
    // Spec 3.80: describe -o wide → NoCompatiblePrinterError, exit non-0.
    // CLI returns exit 1 (not 2) for printer incompatibility on this version.
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'wide'])
    expect(result.exitCode, '-o wide should exit non-zero').not.toBe(0)
    expect(result.stderr).toMatch(/NoCompatiblePrinter|invalid|unsupported|wide/i)
  })

  it('[P0] -o name returns NoCompatiblePrinterError (exit non-0) (3.81)', async () => {
    // Spec 3.81: describe -o name → NoCompatiblePrinterError, exit non-0.
    // CLI returns exit 1 (not 2) for printer incompatibility on this version.
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'name'])
    expect(result.exitCode, '-o name should exit non-zero').not.toBe(0)
    expect(result.stderr).toMatch(/NoCompatiblePrinter|invalid|unsupported|name/i)
  })

  // ── Not found ─────────────────────────────────────────────────────────────

  it('[P0] invalid (non-UUID) app id returns usage error (exit code 2)', async () => {
    // NONEXISTENT_ID is not a valid UUID, so the CLI rejects it client-side via
    // isValidUuid() before making any network request → usage_invalid_flag (exit 2).
    const result = await fx.r(['describe', 'app', NONEXISTENT_ID])
    expect(result.exitCode, 'invalid UUID should exit with code 2').toBe(2)
    expect(result.stderr).toMatch(/uuid|valid|usage_invalid_flag/i)
  })

  it('[P1] non-existent app in JSON mode outputs JSON error envelope', async () => {
    const result = await fx.r(['describe', 'app', NONEXISTENT_ID, '-o', 'json'])
    expect(result.exitCode).not.toBe(0)
    assertErrorEnvelope(result)
  })

  // ── Missing argument ──────────────────────────────────────────────────────

  it('[P1] missing app id returns usage error (3.84)', async () => {
    // Spec 3.84: describe app without id → usage error, exit non-0.
    // CLI returns exit 1 for missing required argument (not 2).
    const result = await fx.r(['describe', 'app'])
    expect(result.exitCode, 'missing id should cause non-zero exit').not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument|required/i)
  })

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('[P0] unauthenticated describe app returns auth error', async () => {
    const tmp = await withTempConfig()
    try {
      const { run } = await import('../../helpers/cli.js')
      const result = await run(['describe', 'app', E.chatAppId], { configDir: tmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth/i)
    } finally {
      await tmp.cleanup()
    }
  })

  // ── External SSO ──────────────────────────────────────────────────────────

  itWithSso('[P0] external SSO user can describe a permitted app', async () => {
    // A dfoe_ token resolves `describe app` via the permitted-external surface
    // (not the account /apps surface), so a permitted app describes successfully.
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
      const result = await run(['describe', 'app', E.chatAppId], { configDir: ssoTmp.configDir })
      assertExitCode(result, 0)
      expect(result.stdout).toMatch(/ID:/i)
      expect(result.stdout).toContain(E.chatAppId)
      expect(result.stdout).toMatch(/Mode:/i)
    } finally {
      await ssoTmp.cleanup()
    }
  })

  // ── Output quality ────────────────────────────────────────────────────────

  it('[P0] describe output has no ANSI colour codes (non-TTY)', async () => {
    // withRetry: staging may return transient 500 on cold start
    const result = await withRetry(() => fx.r(['describe', 'app', E.chatAppId]), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })

  // ── New cases ─────────────────────────────────────────────────────────────

  it('[P1] describe output contains Description field (3.66)', async () => {
    // Spec 3.66: output includes Description when app has a non-empty description.
    // Prerequisite: echo-bot description set to 'e2e-test' in the Dify web console.
    const result = await withRetry(() => fx.r(['describe', 'app', E.chatAppId]), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Description:/i)
    expect(result.stdout).toContain('e2e-test')
  })

  it('[P0] Inputs section shows parameter names (3.70)', async () => {
    // Spec 3.70: Parameters/Inputs section displays variable names.
    // workflow app has x, num, enum_var, paragraph.
    const result = await withRetry(() => fx.r(['describe', 'app', E.workflowAppId]), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/Parameters|Inputs/i)
    expect(result.stdout).toContain('"x"')
    expect(result.stdout).toContain('"num"')
  })

  it('[P0] Inputs section shows parameter types (3.71)', async () => {
    // Spec 3.71: Parameters section displays parameter type info.
    // input_schema is a JSON Schema object with properties.inputs.properties.<var>.type.
    const result = await withRetry(() => fx.r(['describe', 'app', E.workflowAppId, '-o', 'json']), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    const parsed = assertJson<{
      input_schema: { properties?: { inputs?: { properties?: Record<string, { type: string }> } } }
    }>(result)
    const varProps = parsed.input_schema?.properties?.inputs?.properties
    expect(varProps, 'input_schema should expose variable type properties').toBeDefined()
    const types = Object.values(varProps ?? {}).map((v) => v.type)
    expect(types.length, 'should have at least one typed parameter').toBeGreaterThan(0)
    types.forEach((t) => expect(typeof t, 'each type must be a string').toBe('string'))
  })

  it('[P0] Inputs section shows required/optional markers (3.72)', async () => {
    // Spec 3.72: Parameters section shows required/optional per field.
    // user_input_form entries each have a required:boolean flag.
    const result = await withRetry(() => fx.r(['describe', 'app', E.workflowAppId, '-o', 'json']), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    type FormItem = Record<string, { variable: string; required: boolean }>
    const parsed = assertJson<{ parameters: { user_input_form: FormItem[] } }>(result)
    const fields = parsed.parameters.user_input_form
    expect(fields.length, 'user_input_form should have entries').toBeGreaterThan(0)
    fields.forEach((item) => {
      const entry = Object.values(item)[0]!
      expect(typeof entry.required, `field ${entry.variable} must have required flag`).toBe(
        'boolean',
      )
    })
  })

  it('[P0] workflow app with 4 typed fields shows all in Parameters (3.73)', async () => {
    // Spec 3.73: 4-field workflow app — x / num / enum_var / paragraph all appear.
    const result = await withRetry(() => fx.r(['describe', 'app', E.workflowAppId]), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    expect(result.stdout).toContain('"x"')
    expect(result.stdout).toContain('"num"')
    expect(result.stdout).toContain('"enum_var"')
    expect(result.stdout).toContain('"paragraph"')
  })

  it('[P1] enum parameter shows options list (3.74)', async () => {
    // Spec 3.74: enum-type input shows the selectable options.
    // enum_var has options A, B, C.
    const result = await withRetry(() => fx.r(['describe', 'app', E.workflowAppId]), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    // Options A / B / C appear in the raw JSON dump of parameters
    expect(result.stdout).toMatch(/"A"|"B"|"C"/)
  })

  it('[P1] paragraph parameter shows max_length value (3.75)', async () => {
    // Spec 3.75: paragraph input with max_length shows the limit value.
    // paragraph has max_length = 100.
    const result = await withRetry(() => fx.r(['describe', 'app', E.workflowAppId]), {
      attempts: 3,
      delayMs: 2000,
    })
    assertExitCode(result, 0)
    expect(result.stdout).toContain('100')
  })

  it('[P1] network error on describe app returns non-zero exit (3.88)', async () => {
    // Spec 3.88: unreachable host → network error, exit non-0.
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
      const result = await run(['describe', 'app', E.chatAppId], {
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
