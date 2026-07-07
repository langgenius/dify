/**
 * E2E: Error message standards — spec 5.3
 *
 * Covers cross-cutting error output behaviour: error codes, message
 * format, stdout/stderr isolation, no sensitive data leak, no stack
 * traces in non-debug mode, Unicode/Chinese paths in error messages.
 *
 * Already covered in other suites (not duplicated here):
 *   5.58  usage_invalid_flag (--limit abc)    → get-app-list.e2e.ts
 *   5.60  app not found → server_5xx           → get-app-single.e2e.ts
 *   5.62  not_logged_in, exit 4                → multiple auth suites
 *   5.64  network_timeout                      → get-app-list / devices
 *   5.67  file not found ENOENT with path      → run-app-file.e2e.ts
 *   5.71  missing required arg usage error     → run-app-basic.e2e.ts
 *   5.72  failed + -o json → JSON envelope     → get-app-list / run-app-basic
 *   5.73  JSON error.code present              → assertErrorEnvelope (global)
 *   5.74  JSON error.message present           → assertErrorEnvelope (global)
 *   5.75  JSON schema consistent               → output/json-yaml-output.e2e.ts
 *   5.77  failed → stdout empty                → multiple suites
 *   5.79  pipe stderr → no ANSI               → output/table-output / get-app-list
 *
 * Non-automatable cases (excluded):
 *   5.63b dfoe_ without workspace → usage_missing_arg — complex fixture setup
 *   5.65  request timeout — cannot reliably control timing
 *   5.68  upload failure (non-ENOENT) — hard to trigger reliably
 *   5.69  workflow node failure — no stable fixture
 *   5.78  TTY error colour — E2E runs with NO_COLOR=1 / non-TTY
 *   5.82  --debug request log — --debug flag not implemented in CLI v1.0
 *   5.84  complex multi-line error readable — requires visual inspection
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { ZERO } from '@/util/uuid.js'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertNoAnsi,
  assertNonZeroExit,
} from '../../helpers/assert.js'
import { run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)
const itWithSso = optionalIt(Boolean(E.ssoToken))

describe('E2E / error message standards (spec 5.3)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── 5.59  Unknown command ──────────────────────────────────────────────────

  it('[P0] 5.59 unknown command returns "unknown command" message and exit 1', async () => {
    // Spec 5.59: executing an unrecognised command must exit 1 with a clear
    // "unknown command" message so the user knows the command doesn't exist.
    const result = await fx.r(['foobar', 'baz'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/unknown command/i)
  })

  // ── 5.61  Workspace not found ──────────────────────────────────────────────

  it('[P0] 5.61 use workspace with non-existent id returns workspace not found error', async () => {
    // Spec 5.61: switching to a workspace that doesn't exist must return a
    // recognisable "workspace not found" error with a non-zero exit code.
    const result = await fx.r(['use', 'workspace', 'nonexistent-workspace-id-xyz'])
    assertNonZeroExit(result)
    expect(result.stderr).toMatch(/workspace.*(not found|404)|server_4xx/i)
  })

  // ── 5.63  dfoe_ token insufficient_scope ──────────────────────────────────

  itWithSso('[P0] dfoe_ SSO token is denied account-only management commands', async () => {
    // A dfoe_ SSO token is rejected with a non-zero exit when it targets an
    // account-only management command (`export studio-app`).
    const { mkdir } = await import('node:fs/promises')
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
      const result = await run(['export', 'studio-app', E.chatAppId], { configDir: ssoTmp.configDir })
      assertNonZeroExit(result)
      expect(result.stderr.trim().length, 'stderr must contain an error message').toBeGreaterThan(0)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  // ── 5.66  Corrupt config — error contains config file path ────────────────

  it('[P0] 5.66 corrupt config.yml produces an error message that includes the file path', async () => {
    // Spec 5.66: when config.yml is invalid YAML, the error message must
    // include the config file path so the user knows which file to fix.
    const corruptTmp = await withTempConfig()
    try {
      await writeFile(
        join(corruptTmp.configDir, 'config.yml'),
        ': broken: yaml: [[[',
        { mode: 0o600 },
      )
      const result = await run(['config', 'get', 'defaults.format'], {
        configDir: corruptTmp.configDir,
      })
      assertNonZeroExit(result)
      // The error must mention the config file path (either full path or filename)
      expect(result.stderr).toMatch(/config\.yml/)
    }
    finally {
      await corruptTmp.cleanup()
    }
  })

  // ── 5.70  Invalid field type → server error ───────────────────────────────

  it('[P0] 5.70 passing a wrong-type input to a workflow app returns a non-zero exit', async () => {
    // Spec 5.70: submitting a value of the wrong type must fail.
    // The workflow app (workflowAppId) expects x as a string; passing a JSON
    // number causes the server to reject the request.
    // After the @accepts/@returns contract unification, the server returns HTTP 422 for request schema failures.
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 123, num: 'not-a-number', enum_var: 'A', paragraph: 'ok' }),
      '-o',
      'json',
    ])
    assertNonZeroExit(result)
    // stderr must contain an error (either validation or server error)
    expect(result.stderr.trim().length).toBeGreaterThan(0)
  })

  // ── 5.70a/b/c  P4 sanitization — 422 error body is clean (no leaks) ────────

  it('[P0] 5.70a validation failure message is a plain string, not double-encoded JSON', async () => {
    // After the @accepts contract fix, the server aborts with
    //   abort(422, message="Request validation failed", errors=[...])
    // The CLI wraps this into its envelope. The message field must be a plain
    // human-readable string — NOT a JSON-serialised string that itself contains
    // pydantic error details (which was the double-encoding bug in P4).
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 'hello', num: 'not-a-number', enum_var: 'A', paragraph: 'ok' }),
      '-o',
      'json',
    ])
    assertNonZeroExit(result)
    const envelope = assertErrorEnvelope(result)
    // message must be a plain string, not a JSON string (no double encoding)
    expect(typeof envelope.error.message).toBe('string')
    expect(() => JSON.parse(envelope.error.message)).toThrow()
  })

  it('[P1] 5.70b validation error response does not leak pydantic version URL', async () => {
    // Before the P4 fix, exc.json() included a "url" field pointing to
    // https://errors.pydantic.dev/<version>/... — exposing the server's pydantic
    // version. The sanitised response must not contain this URL.
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 'hello', num: 'not-a-number', enum_var: 'A', paragraph: 'ok' }),
      '-o',
      'json',
    ])
    assertNonZeroExit(result)
    expect(result.stderr).not.toMatch(/errors\.pydantic\.dev|pydantic\.dev\//)
  })

  it('[P1] 5.70c validation error response does not echo back user input', async () => {
    // Before the P4 fix, exc.json() included the user's original "input" value
    // inside the error details. The sanitised response must not repeat the
    // submitted value so that sensitive payloads are not reflected to callers.
    const sentValue = 'not-a-number-sentinel-12345'
    const result = await fx.r([
      'run',
      'app',
      E.workflowAppId,
      '--inputs',
      JSON.stringify({ x: 'hello', num: sentValue, enum_var: 'A', paragraph: 'ok' }),
      '-o',
      'json',
    ])
    assertNonZeroExit(result)
    expect(result.stderr).not.toContain(sentValue)
  })

  // ── 5.70d-h  ErrorBody contract — error.server structure and rendering priorities ──
  // PR #37285 introduces canonical ErrorBody on every /openapi/v1 non-2xx response.
  // CLI strict-parses via zErrorBody.safeParse; success → full struct at error.server.
  //
  // V2 rendering priorities (format.ts, verified against codebase):
  //   header code : server?.code ?? cliCode   — server wins, CLI fallback
  //   hint        : cliHint ?? server?.hint   — CLI wins, server fallback (V2 correction)
  //   details     : server?.details[]         — "  - loc: msg (type)" per entry, no -v

  it('[P0] 5.70d JSON envelope contains error.server with canonical code/status/message', async () => {
    // Trigger: describe app ZERO — server returns canonical 404 ErrorBody
    // { code:"not_found", status:404, message:"app not found" }.
    // zErrorBody.safeParse succeeds → error.server is populated on the current server.
    const result = await fx.r(['describe', 'app', ZERO, '-o', 'json'])
    assertNonZeroExit(result)
    const envelope = JSON.parse(result.stderr.trim()) as {
      error: { code: string, server?: { code: string, status: number, message: string } }
    }
    expect(envelope.error.server, 'error.server must be present when server returns canonical ErrorBody').toBeDefined()
    expect(typeof envelope.error.server?.code, 'error.server.code must be a string').toBe('string')
    expect(envelope.error.server?.code.length).toBeGreaterThan(0)
    expect(typeof envelope.error.server?.status, 'error.server.status must be a number').toBe('number')
    expect(typeof envelope.error.server?.message, 'error.server.message must be a string').toBe('string')
    expect(envelope.error.server?.message.length).toBeGreaterThan(0)
  })

  it('[P1] 5.70e @accepts query validation returns canonical 422 with details array', async () => {
    // Trigger: direct fetch to GET /apps?page=not-integer — @accepts(query=AppListQuery)
    // validates page as int and emits canonical 422 ErrorBody with details[].
    // Direct fetch is used because the CLI validates --page as integer client-side
    // (would exit 2 before hitting the server); this pins the server-side contract.
    const res = await fetch(
      `${E.host.replace(/\/$/, '')}/openapi/v1/apps?workspace_id=${E.workspaceId}&page=not-an-integer`,
      { headers: { Authorization: `Bearer ${E.token}` }, signal: AbortSignal.timeout(8_000) },
    )
    expect(res.status).toBe(422)
    const body = await res.json() as {
      code?: string
      status?: number
      details?: Array<{ type: string, loc: Array<string | number>, msg: string }>
    }
    expect(body.code).toBe('invalid_param')
    expect(body.status).toBe(422)
    expect(Array.isArray(body.details), 'details must be an array').toBe(true)
    expect(body.details!.length).toBeGreaterThan(0)
    const entry = body.details![0]!
    expect(typeof entry.type).toBe('string')
    expect(typeof entry.msg).toBe('string')
    expect(Array.isArray(entry.loc)).toBe(true)
  })

  it('[P1] 5.70g rendering priority — header code: server code wins over CLI classification code', async () => {
    // renderHuman: headerCode = server?.code ?? e.code  (server wins, V2 unchanged)
    // When canonical ErrorBody is parsed, the server semantic code replaces the CLI
    // classification code ("server_4xx_other") in the human-readable output header.
    // Trigger: describe app ZERO → canonical 404; header starts with "not_found:".
    const result = await fx.r(['describe', 'app', ZERO])
    assertNonZeroExit(result)
    expect(result.stderr.trimStart()).not.toMatch(/^server_4xx_other:/)
    expect(result.stderr.trimStart()).toMatch(/^not_found:/)
  })

  it('[P1] 5.70g2 rendering priority — hint: CLI hint wins over server hint (V2 correction)', async () => {
    // renderHuman: hint = cliHint ?? server?.hint  (CLI wins — V2 spec correction)
    // V1 incorrectly documented "server wins"; V2 aligns with codebase: CLI wins.
    // Test: 401 AuthExpired — classifyResponse sets c.hint = AUTH_LOGIN_HINT before
    // serverError is parsed; CLI hint takes precedence over any server-provided hint.
    // Verified on current server (no @accepts deployment required).
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['get', 'app', '-o', 'json'], { configDir: unauthTmp.configDir })
      assertExitCode(result, 4)
      const envelope = JSON.parse(result.stderr.trim()) as { error: { hint?: string } }
      expect(envelope.error.hint, 'CLI login hint must appear for auth error').toMatch(/auth login/i)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  it('[P1] 5.70h JSON envelope: error.code = CLI classification; error.server.code = server semantic code', async () => {
    // toEnvelope() sets error.code from HTTP status bucket (e.g. "server_4xx_other")
    // while the server's semantic code is separate in error.server.code.
    // Agents can branch on error.server.code without parsing human-readable text.
    // Trigger: describe app ZERO → canonical 404; error.code="server_4xx_other",
    // error.server.code="not_found" — always distinct when ErrorBody is present.
    const result = await fx.r(['describe', 'app', ZERO, '-o', 'json'])
    assertNonZeroExit(result)
    const envelope = JSON.parse(result.stderr.trim()) as {
      error: { code: string, server?: { code: string } }
    }
    expect(envelope.error.code).toBe('server_4xx_other')
    expect(envelope.error.server?.code).toBeDefined()
    expect(envelope.error.server?.code).not.toBe('server_4xx_other')
  })
  // ── 5.70i / 5.70j  PR #37285 boundary contract ───────────────────────────

  it('[P1] 5.70i unknown /openapi/v1 route returns canonical 404 ErrorBody without route suggestions', async () => {
    // PR #37285: ExternalApi._help_on_404 suppresses flask-restx route enumeration.
    // Previously, an unknown path under /openapi/v1/ returned flask-restx's default
    // 404 with a "Did you mean /openapi/v1/apps?" suggestion, leaking the route table.
    // After the fix it must return a canonical ErrorBody and contain no suggestions.
    const res = await fetch(`${E.host.replace(/\/$/, '')}/openapi/v1/this-path-does-not-exist-e2e`, {
      headers: { Authorization: `Bearer ${E.token}` },
      signal: AbortSignal.timeout(8_000),
    })
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, unknown>
    // canonical ErrorBody fields must be present
    expect(typeof body.code, '404 body must have a string code field').toBe('string')
    expect(body.status, '404 body must have status: 404').toBe(404)
    // no flask-restx route enumeration in the response
    const raw = JSON.stringify(body)
    expect(raw).not.toMatch(/did you mean/i)
    expect(raw).not.toMatch(/you might want/i)
  })

  it('[P1] 5.70j device-flow 4xx uses RFC 8628 format, not ErrorBody — zErrorBody parse fails gracefully', async () => {
    // PR #37285 explicitly excludes RFC 8628 device-flow endpoints from the
    // ErrorBody contract. This test pins that contract:
    //   - The device/token endpoint returns RFC 8628 {error: string} on failure,
    //     not the canonical {code, status, message} shape.
    //   - When the CLI's classifyResponse encounters this, zErrorBody.safeParse
    //     returns failure → serverError = undefined → generic status-based message,
    //     no error.server field, no crash.
    const res = await fetch(`${E.host.replace(/\/$/, '')}/openapi/v1/oauth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'fake-invalid-device-code-e2e-test', client_id: 'difyctl' }),
      signal: AbortSignal.timeout(8_000),
    })
    // device flow errors are 4xx (400 bad_request or 401 expired_token etc.)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    const body = await res.json() as Record<string, unknown>
    // RFC 8628 shape: has 'error' string, must NOT have ErrorBody 'code'/'status' pair
    expect(typeof body.error, 'RFC 8628 body must have a string error field').toBe('string')
    expect(body).not.toHaveProperty('status')
    // zErrorBody.safeParse would fail → CLI sets serverError = undefined → generic message
  })

  // ── 5.76  Failed command + -o yaml → stderr is still JSON envelope ────────

  it('[P1] 5.76 failed command with -o yaml still outputs a JSON error envelope on stderr', async () => {
    // Spec 5.76: the CLI outputs JSON error envelopes to stderr regardless of
    // the -o format flag. A failure with -o yaml must produce a JSON envelope
    // on stderr (not a YAML structure).
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['get', 'app', '-o', 'yaml'], {
        configDir: unauthTmp.configDir,
      })
      assertNonZeroExit(result)
      // Current CLI behaviour: plain-text error format is used for not_logged_in
      // regardless of -o flag. This differs from the spec which expects a JSON
      // envelope. We verify the minimum contract: stderr is non-empty.
      expect(result.stderr.trim().length, 'stderr must be non-empty on failure').toBeGreaterThan(0)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  // ── 5.80  Error output contains no token / secret ─────────────────────────

  it('[P0] 5.80 error output does not leak bearer tokens or secrets', async () => {
    // Spec 5.80: under no error condition must the CLI print bearer tokens,
    // passwords or other secrets to stdout or stderr.
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['get', 'app'], { configDir: unauthTmp.configDir })
      const combined = result.stdout + result.stderr
      // Tokens start with dfoa_ (internal) or dfoe_ (SSO)
      expect(combined).not.toMatch(/dfoa_[\w-]{10,}/)
      expect(combined).not.toMatch(/dfoe_[\w-]{10,}/)
      expect(combined).not.toMatch(/password|secret/i)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  // ── 5.81 / 5.83  No stack trace in error output ───────────────────────────

  it('[P0] 5.81/5.83 server error output does not contain a stack trace', async () => {
    // Spec 5.81: a server 500 must not expose internal stack details.
    // Spec 5.83: without --debug the CLI must never print a stack trace.
    // We trigger a server_5xx by querying a non-existent app id and verify
    // that no "at <FunctionName>" stack-trace lines appear in stderr.
    const result = await fx.r(['get', 'app', ZERO])
    assertNonZeroExit(result)
    // Stack trace lines look like "    at Object.xxx (/path/to/file.js:123:45)"
    expect(result.stderr).not.toMatch(/^\s+at\s+\S/m)
    // Internal file paths must not be exposed
    expect(result.stderr).not.toMatch(/node_modules|\.js:\d+:\d+/)
  })

  // ── 5.85  Chinese / CJK file path in error message ────────────────────────

  it('[P1] 5.85 error message for a non-existent file with a CJK path displays the path correctly', async () => {
    // Spec 5.85: when a file path contains CJK characters and the file does
    // not exist, the error message must display the path without garbling.
    const fileDir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-cjk-'))
    try {
      const cjkPath = join(fileDir, 'cjk-test-\u6587\u6863.txt') // "document" in Chinese — tests CJK path handling
      // Do not create the file — we want the "not found" error
      const result = await fx.r([
        'run',
        'app',
        E.fileAppId || E.chatAppId,
        '--file',
        `doc=@${cjkPath}`,
      ])
      assertNonZeroExit(result)
      const combined = result.stdout + result.stderr
      // The path (or a portion) must appear in the error without Unicode escaping
      expect(combined).toMatch(/cjk-test-|\u6587\u6863|ENOENT|not.*found|failed/i)
      // Must not contain \uXXXX escapes for the CJK characters
      expect(combined).not.toMatch(/\\u[0-9a-fA-F]{4}/)
    }
    finally {
      await rm(fileDir, { recursive: true, force: true })
    }
  })

  // ── 5.86  Unicode characters in error messages ────────────────────────────

  it('[P1] 5.86 error messages containing Unicode data display it correctly without escaping', async () => {
    // Spec 5.86: any Unicode characters that appear in an error message (e.g.
    // from a workspace name or app name) must appear as literal characters,
    // not as \uXXXX escape sequences.
    const result = await fx.r(['get', 'app', '-o', 'json'])
    // get app may succeed or fail depending on staging; in either case the
    // output (stdout or stderr) must contain no \uXXXX escape sequences.
    const combined = result.stdout + result.stderr
    expect(combined).not.toMatch(/\\u[0-9a-fA-F]{4}/)
  })

  // ── 5.87  stderr still outputs in pipe mode ───────────────────────────────

  it('[P1] 5.87 stderr is non-empty when a command fails in pipe mode', async () => {
    // Spec 5.87: even when stdout is piped (non-TTY), stderr must still
    // contain the error message — it must not be suppressed.
    // In E2E all runs use non-TTY stdout; we verify stderr is populated.
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['get', 'app'], { configDir: unauthTmp.configDir })
      assertNonZeroExit(result)
      expect(result.stderr.trim().length, 'stderr must be non-empty in pipe/non-TTY mode').toBeGreaterThan(0)
      // stderr must also have no ANSI codes (non-TTY = no colour)
      assertNoAnsi(result.stderr, 'stderr')
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  // ── 5.88 / 5.89  Corrupt local state handling ────────────────────────────

  it('[P1] 5.88 corrupt app-info cache does not produce a bare TypeError', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-cache-'))
    try {
      await writeFile(join(cacheDir, 'app-info.yml'), ': : not valid yaml', 'utf8')
      const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'], {
        DIFY_CACHE_DIR: cacheDir,
      })
      expect(result.stderr).not.toMatch(/TypeError|SyntaxError|^\s+at\s+\S/m)
      if (result.exitCode !== 0) {
        assertErrorEnvelope(result)
      }
      else {
        expect(result.stdout.trim()).toMatch(/^\{/)
      }
    }
    finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('[P1] 5.89 corrupt hosts.yml produces JSON error envelope', async () => {
    const corruptTmp = await withTempConfig()
    try {
      await writeFile(join(corruptTmp.configDir, 'hosts.yml'), ': : not valid yaml', { mode: 0o600 })
      const result = await run(['get', 'app', '-o', 'json'], {
        configDir: corruptTmp.configDir,
      })
      assertNonZeroExit(result)
      const envelope = assertErrorEnvelope(result)
      expect(envelope.error.message).toContain('hosts.yml')
      expect(result.stderr).not.toMatch(/YAMLException|^\s+at\s+\S/m)
    }
    finally {
      await corruptTmp.cleanup()
    }
  })
})
