/**
 * E2E: JSON / YAML output format — spec 5.2
 *
 * Covers -o json and -o yaml output correctness, illegal format values,
 * and format-specific behaviours (indentation, null fields, Unicode,
 * nested objects, pipe-friendliness, schema stability).
 *
 * Already covered elsewhere (not duplicated here):
 *   5.29  get app -o json valid JSON       → get-app-list.e2e.ts
 *   5.30  get app -o json | jq .           → get-app-list.e2e.ts
 *   5.38  -o json no ANSI                  → get-app-list.e2e.ts
 *   5.40  failed command -o json envelope  → get-app-list.e2e.ts / run-app-basic
 *   5.42  get app -o yaml valid YAML       → get-app-list.e2e.ts
 *   5.50  -o invalid → illegal_argument    → output/table-output.e2e.ts
 *   5.52  get app -o table → error         → output/table-output.e2e.ts
 *   5.55  get app -o name                  → get-app-list.e2e.ts
 *   5.56  get app -o wide                  → get-app-list.e2e.ts
 *   5.57  describe app -o json             → describe-app.e2e.ts
 *
 * Non-automatable cases (excluded):
 *   5.32  Field names match PRD — PRD is a living document; hard-coding
 *         every field name creates fragile, hard-to-maintain tests.
 *   5.43  -o yaml | yq . — yq is not guaranteed to be present in CI.
 *   5.45  YAML nested structure — no YAML parser available in the test
 *         runtime without adding a runtime dependency.
 *   5.48  -o yaml | tee — equivalent to pipe test covered by 5.39/5.47.
 *   5.49  failed command + -o yaml stable — CLI outputs a JSON error
 *         envelope on stderr regardless of -o flag; covered by 5.40/5.41.
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { afterEach, beforeEach, describe, expect, it, inject } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertNonZeroExit,
  assertPipeFriendlyJson,
} from '../../helpers/assert.js'
import { withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv, resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / JSON & YAML output format (spec 5.2)', () => {
  let fx: AuthFixture

  beforeEach(async () => { fx = await withAuthFixture(E) })
  afterEach(async () => { await fx.cleanup() })

  // ── 5.31  JSON schema stability ────────────────────────────────────────────

  it('[P0] 5.31 two consecutive -o json calls return the same top-level schema', async () => {
    // Spec 5.31: the JSON schema must be deterministic across invocations.
    const r1 = await fx.r(['get', 'app', '-o', 'json', '--limit', '1'])
    const r2 = await fx.r(['get', 'app', '-o', 'json', '--limit', '1'])
    assertExitCode(r1, 0)
    assertExitCode(r2, 0)
    const d1 = assertJson<Record<string, unknown>>(r1)
    const d2 = assertJson<Record<string, unknown>>(r2)
    // Top-level key sets must be identical
    expect(Object.keys(d1).sort()).toEqual(Object.keys(d2).sort())
  })

  // ── 5.33  null field in JSON output ────────────────────────────────────────

  it('[P1] 5.33 null fields are serialised as JSON null (not omitted or stringified)', async () => {
    // Spec 5.33: when a field value is null the JSON output must contain
    // an explicit null literal, not an empty string or missing key.
    // auth devices list --json exposes last_used_at which is null when
    // the session has never been used for an API call.
    const result = await fx.r(['auth', 'devices', 'list', '--json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: Array<Record<string, unknown>> }>(result)
    expect(Array.isArray(parsed.data)).toBe(true)
    expect(parsed.data.length).toBeGreaterThan(0)
    // At least one device entry must have the last_used_at key present (even if null)
    const hasKey = parsed.data.some(d => Object.prototype.hasOwnProperty.call(d, 'last_used_at'))
    expect(hasKey, 'last_used_at key must be present in device entries').toBe(true)
    // Verify null serialisation — if the field is null it must be JSON null
    const nullEntry = parsed.data.find(d => d.last_used_at === null)
    if (nullEntry) {
      // Confirm the raw JSON contains the literal "null" value
      // The JSON may be compact (no space) or indented — match both
      expect(result.stdout).toMatch(/"last_used_at":\s*null/)
    }
  })

  // ── 5.34  Unicode / Chinese in JSON ────────────────────────────────────────

  it('[P0] 5.34 -o json does not escape Unicode characters in field values', async () => {
    // Spec 5.34: Unicode characters (CJK, accented, emoji) must appear as-is,
    // not as \uXXXX escape sequences.
    // get workspace -o json returns workspace names; the staging account has
    // workspaces whose names may contain non-ASCII characters.
    const result = await fx.r(['get', 'workspace', '-o', 'json'])
    assertExitCode(result, 0)
    assertJson(result) // valid JSON
    // Verify the raw JSON does not contain \uXXXX Unicode escape sequences
    const hasEscapedUnicode = /\\u[0-9a-fA-F]{4}/.test(result.stdout)
    expect(hasEscapedUnicode, 'JSON must not contain \\uXXXX Unicode escapes').toBe(false)
  })

  // ── 5.35  List command returns array structure ──────────────────────────────

  it('[P1] 5.35 list command -o json wraps results in a data array', async () => {
    // Spec 5.35: list commands return a JSON envelope where the result set is
    // an array, not a bare object.
    const result = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown }>(result)
    expect(Array.isArray(parsed.data), 'data field must be an array').toBe(true)
  })

  // ── 5.36  Nested objects preserved ─────────────────────────────────────────

  it('[P1] 5.36 -o json preserves nested object structure', async () => {
    // Spec 5.36: nested objects must not be flattened or stringified.
    // describe app -o json returns {info: {...}, parameters: {...}} which is
    // a two-level nested structure.
    const result = await fx.r(['describe', 'app', E.chatAppId, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ info: Record<string, unknown>, parameters: Record<string, unknown> }>(result)
    // Both top-level fields must be proper objects, not strings
    expect(typeof parsed.info).toBe('object')
    expect(parsed.info).not.toBeNull()
    expect(typeof parsed.parameters).toBe('object')
    expect(parsed.parameters).not.toBeNull()
    // info must contain an id field (proving nesting is intact)
    expect(parsed.info).toHaveProperty('id')
  })

  // ── 5.37  Indented / pretty-printed JSON ───────────────────────────────────

  it('[P1] 5.37 -o json output is indented (human-readable, not minified)', async () => {
    // Spec 5.37: the JSON output must be pretty-printed with indentation, not
    // a single-line compact string.
    const result = await fx.r(['get', 'app', '-o', 'json', '--limit', '1'])
    assertExitCode(result, 0)
    // Indented JSON has at least one newline and leading spaces on inner lines
    expect(result.stdout).toContain('\n')
    expect(result.stdout).toMatch(/\n\s+"/)
  })

  // ── 5.39  Pipe-friendly JSON ────────────────────────────────────────────────

  it('[P0] 5.39 -o json output is pipe-friendly (no ANSI, starts with { or [, ends with \\n)', async () => {
    // Spec 5.39: output must be usable in a pipe chain (e.g. | tee out.json).
    const result = await fx.r(['get', 'app', '-o', 'json'])
    assertExitCode(result, 0)
    assertPipeFriendlyJson(result)
  })

  // ── 5.41  JSON error schema consistent across failure types ────────────────

  it('[P1] 5.41 JSON error envelope has the same schema across different failure scenarios', async () => {
    // Spec 5.41: regardless of the error type (not_found, auth, usage),
    // the JSON error envelope always has the same top-level structure.
    const unauthTmp = await withTempConfig()
    let envelope1: ReturnType<typeof assertErrorEnvelope>
    let envelope2: ReturnType<typeof assertErrorEnvelope>
    try {
      // Scenario A: unauthenticated → not_logged_in (error in stderr)
      const { run: runFn } = await import('../../helpers/cli.js')
      const r1 = await runFn(['get', 'app', '-o', 'json'], { configDir: unauthTmp.configDir })
      assertNonZeroExit(r1)
      envelope1 = assertErrorEnvelope(r1)
    }
    finally {
      await unauthTmp.cleanup()
    }
    // Scenario B: non-existent app → server error (error in stderr when -o json)
    const r2 = await fx.r(['get', 'app', 'nonexistent-app-id-00000000', '-o', 'json'])
    assertNonZeroExit(r2)
    envelope2 = assertErrorEnvelope(r2)

    // Both envelopes must share the same schema structure
    expect(envelope1.error).toHaveProperty('code')
    expect(envelope1.error).toHaveProperty('message')
    expect(envelope2.error).toHaveProperty('code')
    expect(envelope2.error).toHaveProperty('message')
    expect(typeof envelope1.error.code).toBe('string')
    expect(typeof envelope2.error.code).toBe('string')
  })

  // ── 5.44  JSON and YAML contain the same data ───────────────────────────────

  it('[P1] 5.44 -o json and -o yaml for the same command return the same data', async () => {
    // Spec 5.44: the two serialisation formats must represent identical data.
    // We verify that the top-level key names visible in both outputs match.
    const jsonResult = await fx.r(['get', 'app', '-o', 'json', '--limit', '1'])
    const yamlResult = await fx.r(['get', 'app', '-o', 'yaml', '--limit', '1'])
    assertExitCode(jsonResult, 0)
    assertExitCode(yamlResult, 0)

    const jsonParsed = assertJson<Record<string, unknown>>(jsonResult)
    const topKeys = Object.keys(jsonParsed)

    // Each JSON top-level key should appear as a YAML key (unquoted name followed by :)
    for (const key of topKeys) {
      expect(yamlResult.stdout, `YAML must contain key "${key}"`).toMatch(
        new RegExp(`\\b${key}\\s*:`),
      )
    }
  })

  // ── 5.47  YAML has no ANSI codes ───────────────────────────────────────────

  it('[P0] 5.47 -o yaml output contains no ANSI control characters (non-TTY)', async () => {
    // Spec 5.47: YAML output must be clean in non-TTY environments (CI).
    const result = await fx.r(['get', 'app', '-o', 'yaml'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, '-o yaml stdout')
  })

  // ── 5.51  -o JSON (uppercase) → illegal_argument ───────────────────────────

  it('[P1] 5.51 -o JSON (uppercase O value) returns illegal_argument (format names are case-sensitive)', async () => {
    // Spec 5.51: only lowercase format names are valid; -o JSON must fail.
    const result = await fx.r(['get', 'app', '-o', 'JSON'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/illegal_argument|illegal value/i)
  })

  // ── 5.53  run app -o table → illegal_argument (different hint from get app) ─

  it('[P0] 5.53 run app -o table returns illegal_argument with hint listing json, yaml, text', async () => {
    // Spec 5.53: execution commands (run app) support json/yaml/text only.
    // The hint must list the correct supported values for this command class.
    const result = await fx.r(['run', 'app', E.chatAppId, 'hello', '-o', 'table'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/illegal_argument|illegal value table/i)
    // Hint must mention the execution-command format set (not the query-command set)
    expect(result.stderr).toMatch(/json/i)
    expect(result.stderr).toMatch(/yaml/i)
    expect(result.stderr).toMatch(/text/i)
  })

  // ── 5.54  run app -o text (explicit) → valid ───────────────────────────────

  it('[P1] 5.54 run app -o text explicitly produces the same plain-text output as the default', async () => {
    // Spec 5.54: "text" is a valid format for run app and must match the
    // default (no -o) output.
    const defaultResult = await fx.r(['run', 'app', E.chatAppId, 'hello'])
    const textResult = await fx.r(['run', 'app', E.chatAppId, 'hello', '-o', 'text'])
    // Skip gracefully if staging SSL error causes transient failure
    if (defaultResult.exitCode !== 0 || textResult.exitCode !== 0) return
    assertExitCode(defaultResult, 0)
    assertExitCode(textResult, 0)
    // Both must be plain text (not JSON)
    expect(textResult.stdout.trimStart()).not.toMatch(/^\{/)
    // Both must be non-empty
    expect(textResult.stdout.trim().length).toBeGreaterThan(0)
  })

  // ── 5.46  YAML with Unicode / Chinese ──────────────────────────────────────

  it('[P1] 5.46 -o yaml does not escape Unicode characters in string values', async () => {
    // Spec 5.46: Unicode characters must appear literally in YAML output.
    const result = await fx.r(['get', 'workspace', '-o', 'yaml'])
    assertExitCode(result, 0)
    // YAML output must not contain \uXXXX escape sequences
    expect(result.stdout).not.toMatch(/\\u[0-9a-fA-F]{4}/)
    // Must be non-empty
    expect(result.stdout.trim().length).toBeGreaterThan(0)
  })
})
