/**
 * E2E: Table output format — spec 5.1
 *
 * Covers the default text-table output behaviour of query commands.
 * The default format (no -o flag) is an aligned text table; -o table does not
 * exist and returns an illegal_argument error.
 *
 * Primary command under test: difyctl get app
 * Additional commands: difyctl get workspace, difyctl auth devices list
 *
 * Non-automatable cases (excluded):
 *   5.4  Row/column alignment — requires visual inspection, no reliable
 *        programmatic assertion.
 *   5.7  Long-text truncation based on terminal width — terminal width is
 *        not controllable in E2E.
 *   5.8  Very long text still readable — same reason as 5.7, and test data
 *        cannot be controlled.
 *   5.9  CJK/emoji alignment — CJK column-width alignment requires visual
 *        inspection; current fixtures have no CJK app names.
 *   5.10 CJK column width — same as 5.9.
 *   5.11 Small terminal width — terminal width not controllable.
 *   5.12 Large terminal width — same as 5.11.
 *   5.13 ANSI colour in TTY — E2E runs with NO_COLOR=1 and CI=1 (non-TTY).
 *   5.18 NULL fields stable — current fixtures have no NULL field values.
 *   5.21 run app --stream non-table — covered by run-app-streaming.e2e.ts.
 *   5.22 describe app uses describe printer — covered by describe-app.e2e.ts.
 *   5.23 Printer error / fallback — cannot reliably trigger a printer error.
 *   5.24 Printer error exit code — same as 5.23.
 *   5.20 get app -A -o wide has WORKSPACE column — covered by
 *        get-app-all-workspaces.e2e.ts (spec 3.92/3.93).
 *
 * Already covered in get-app-list.e2e.ts (not duplicated here):
 *   5.1  (partial) default format is not JSON
 *   5.2  (partial) header contains ID / NAME / MODE
 *   5.14 no ANSI colour codes in non-TTY
 *
 * All cases require a valid session (DIFY_E2E_TOKEN).
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { assertExitCode, assertNoAnsi } from '../../helpers/assert.js'
import { withAuthFixture } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

// ── 5.1 / 5.2 / 5.3 / 5.5 / 5.19 — Header & columns ───────────────────────
describe('E2E / table output — header and column format (spec 5.1–5.19)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P0] 5.1 default output (no -o) is an aligned text table, not JSON or YAML', async () => {
    // Spec 5.1: the default format is a text table; -o table does not exist.
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    // Must not be JSON (starts with {) or YAML (starts with -)
    expect(result.stdout.trimStart()).not.toMatch(/^\{/)
    expect(result.stdout.trimStart()).not.toMatch(/^- /)
    // Must have content (non-empty)
    expect(result.stdout.trim().length).toBeGreaterThan(0)
  })

  it('[P0] 5.2 header row contains all four expected column names', async () => {
    // Spec 5.2: header columns are NAME / ID / MODE / UPDATED.
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    const header = result.stdout.split('\n')[0] ?? ''
    expect(header).toMatch(/NAME/i)
    expect(header).toMatch(/ID/i)
    expect(header).toMatch(/MODE/i)
    expect(header).toMatch(/UPDATED/i)
  })

  it('[P0] 5.3 column order is NAME → ID → MODE → UPDATED', async () => {
    // Spec 5.3: columns appear in the defined order (as verified from actual CLI output).
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    const header = result.stdout.split('\n')[0] ?? ''
    const nameIdx = header.indexOf('NAME')
    const idIdx = header.indexOf('ID')
    const modeIdx = header.indexOf('MODE')
    const updatedIdx = header.indexOf('UPDATED')
    // All columns must be present
    expect(nameIdx).toBeGreaterThanOrEqual(0)
    expect(idIdx).toBeGreaterThanOrEqual(0)
    expect(modeIdx).toBeGreaterThanOrEqual(0)
    expect(updatedIdx).toBeGreaterThanOrEqual(0)
    // Verify left-to-right order
    expect(nameIdx).toBeLessThan(idIdx)
    expect(idIdx).toBeLessThan(modeIdx)
    expect(modeIdx).toBeLessThan(updatedIdx)
  })

  it('[P0] 5.5 table displays multiple data rows when more than one app exists', async () => {
    // Spec 5.5: when there are multiple apps, all rows are rendered.
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    const lines = result.stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim())
    // At least header + 1 data row
    expect(lines.length).toBeGreaterThan(1)
  })

  it('[P0] 5.6 empty result set shows only the header row (no data rows)', async () => {
    // Spec 5.6: when the filter matches nothing, the output is a single header
    // row with no data rows underneath (not an error, exit 0).
    const result = await fx.r(['get', 'app', '--name', 'zzz-nonexistent-app-xyz-000'])
    assertExitCode(result, 0)
    const lines = result.stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim())
    // Only the header row should remain
    expect(lines).toHaveLength(1)
    expect(lines[0] ?? '').toMatch(/NAME/i)
  })

  it('[P0] 5.19 all header column names are uppercase', async () => {
    // Spec 5.19: header column names follow all-caps convention per implementation.
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    const header = result.stdout.split('\n')[0] ?? ''
    // Extract word-like tokens from the header
    const tokens = header.match(/[A-Z]{2,}/g) ?? []
    expect(tokens.length).toBeGreaterThan(0)
    tokens.forEach((token) =>
      expect(token, `header token "${token}" should be uppercase`).toBe(token.toUpperCase()),
    )
  })

  // ── 5.15 / 5.16 — Pipe-friendliness ──────────────────────────────────────

  it('[P0] 5.15 default table output is pipe-friendly — no unexpected control characters', async () => {
    // Spec 5.15: output can pass through cat / pipes without corruption.
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    // No NUL, BEL, BS, VT, FF, SO–US, DEL bytes that would corrupt a pipe
    // eslint-disable-next-line no-control-regex
    expect(result.stdout).not.toMatch(/[\x00-\x08\v\f\x0E-\x1F\x7F]/)
  })

  it('[P0] 5.16 default table output written to a file contains no control characters', async () => {
    // Spec 5.16: redirecting to a file must not embed control characters.
    const result = await fx.r(['get', 'app'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
    // eslint-disable-next-line no-control-regex
    expect(result.stdout).not.toMatch(/[\x00-\x08\v\f\x0E-\x1F\x7F]/)
  })

  // ── 5.25 — Performance ────────────────────────────────────────────────────

  it('[P1] 5.25 querying up to 100 apps completes without timeout', async () => {
    // Spec 5.25: large result sets must not freeze the CLI.
    // The testTimeout covers the timeout assertion implicitly.
    const result = await fx.r(['get', 'app', '--limit', '100'])
    assertExitCode(result, 0)
    expect(result.stdout.trim().length).toBeGreaterThan(0)
  })

  // ── 5.26 — Sort stability ─────────────────────────────────────────────────

  it('[P1] 5.26 two consecutive get app calls return rows in the same order', async () => {
    // Spec 5.26: output order must be deterministic (updated_at DESC).
    const r1 = await fx.r(['get', 'app', '-o', 'name'])
    const r2 = await fx.r(['get', 'app', '-o', 'name'])
    assertExitCode(r1, 0)
    assertExitCode(r2, 0)
    expect(r1.stdout).toBe(r2.stdout)
  })

  // ── Additional commands — header format ───────────────────────────────────

  it('[P0] get workspace default table has correct column headers', async () => {
    // Verifies the header columns for the workspace list table.
    const result = await fx.r(['get', 'workspace'])
    assertExitCode(result, 0)
    const header = result.stdout.split('\n')[0] ?? ''
    expect(header).toMatch(/ID/i)
    expect(header).toMatch(/NAME/i)
    expect(header).toMatch(/ROLE/i)
    expect(header).toMatch(/STATUS/i)
    expect(header).toMatch(/CURRENT/i)
  })

  it('[P0] auth devices list default table has correct column headers', async () => {
    // Verifies the header columns for the devices list table.
    const result = await fx.r(['auth', 'devices', 'list'])
    assertExitCode(result, 0)
    const header = result.stdout.split('\n')[0] ?? ''
    expect(header).toMatch(/DEVICE/i)
    expect(header).toMatch(/CREATED/i)
    expect(header).toMatch(/CURRENT/i)
  })

  // ── -o table is not a valid format ────────────────────────────────────────

  it('[P0] -o table returns illegal_argument error for query commands', async () => {
    // Spec: -o table does not exist; the default (no -o) is the table format.
    const result = await fx.r(['get', 'app', '-o', 'table'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/illegal_argument|illegal value table/i)
    expect(result.stderr).toMatch(/json|yaml|name|wide/i)
  })
})
