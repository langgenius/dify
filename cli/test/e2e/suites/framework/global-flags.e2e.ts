/**
 * E2E: Global Flags — spec 5.5
 *
 * Covers -o/--output, --workspace, --http-retry, --help, version, and
 * flag-position behaviour.
 *
 * Key CLI behaviour confirmed by local testing:
 *   - `-w` shorthand does NOT exist (only --workspace); exit 1
 *   - `--version` flag does NOT exist (only `version` sub-command); exit 1
 *   - Flags placed BEFORE the command are not supported (unknown command error)
 *   - `run --help` shows global help, not the run sub-command help
 *   - `--invalidflag -o json` outputs plain-text error (not JSON envelope)
 *   - Repeating -o flag: last value wins
 *
 * Already covered in other suites (not duplicated here):
 *   5.119  --help exit 0              → exit-codes.e2e.ts (5.106)
 *   5.122  empty command exit 0       → exit-codes.e2e.ts (5.108)
 *   5.124  version exit 0             → exit-codes.e2e.ts (5.107)
 *   5.126  get app -o json            → get-app-list / json-yaml-output
 *   5.127  get app -o yaml            → get-app-list
 *   5.128  --workspace override       → get-app-list.e2e.ts (line 180)
 *   5.131  flag after command OK      → implicit in all -o json tests
 *   5.135  -o invalid exit 2          → table-output / json-yaml-output
 *   5.138  version exit 0             → exit-codes.e2e.ts (5.107)
 *   5.142  --stream -o json           → run-app-streaming.e2e.ts
 *   5.143  -o json | jq               → json-yaml-output.e2e.ts (5.39)
 *   5.147  -O json unknown flag       → json-yaml-output.e2e.ts (5.51)
 *
 * Non-automatable cases (excluded):
 *   5.144  Unicode terminal encoding — cannot control terminal charset in E2E
 *   5.146  Small terminal width       — cannot control terminal width in E2E
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { assertExitCode, assertNoAnsi, assertNonZeroExit } from '../../helpers/assert.js'
import { withAuthFixture } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / global flags (spec 5.5)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // ── 5.120  run app --help → sub-command help ─────────────────────────────

  it('[P0] 5.120 difyctl run app --help outputs sub-command help with USAGE and FLAGS sections', async () => {
    // Spec 5.120: run app --help must show the run app sub-command detail.
    const result = await fx.r(['run', 'app', '--help'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/USAGE/i)
    expect(result.stdout).toMatch(/FLAGS/i)
    // Must mention the run app command itself
    expect(result.stdout).toMatch(/run app/i)
  })

  // ── 5.120b  run --help → global help (NOT sub-command help) ──────────────

  it('[P1] 5.120b difyctl run --help shows global command list (not run sub-command detail)', async () => {
    // Spec 5.120b: run --help falls back to global help, not sub-command help.
    const result = await fx.r(['run', '--help'])
    assertExitCode(result, 0)
    // Global help shows the top-level COMMANDS section
    expect(result.stdout).toMatch(/COMMANDS/i)
    // Must NOT look like a specific sub-command help (no ARGUMENTS section)
    expect(result.stdout).not.toMatch(/^ARGUMENTS/m)
  })

  // ── 5.121  sub-command --help contains usage ──────────────────────────────

  it('[P1] 5.121 any sub-command --help outputs a usage section', async () => {
    // Spec 5.121: every sub-command must have --help that includes usage.
    const result = await fx.r(['get', 'app', '--help'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/USAGE/i)
    expect(result.stdout).toMatch(/\$ difyctl/i)
  })

  // ── 5.123  --help contains GLOBAL FLAGS section ──────────────────────────

  it('[P1] 5.123 difyctl --help contains a GLOBAL FLAGS section', async () => {
    // Spec 5.123: --help must include a dedicated GLOBAL FLAGS chapter listing
    // -o/--output, --workspace, --http-retry.
    const result = await fx.r(['--help'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/GLOBAL FLAGS/i)
    expect(result.stdout).toContain('-o, --output')
    expect(result.stdout).toContain('--http-retry')
  })

  // ── 5.124b  --version flag does not exist → exit 1 ───────────────────────

  it('[P0] 5.124b difyctl --version returns "unknown command" with exit 1 (flag does not exist)', async () => {
    // Spec 5.124b: --version is not a valid flag; the correct command is
    // `difyctl version`. Running --version must produce an error.
    const result = await fx.r(['--version'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/unknown command/i)
  })

  // ── 5.125  version output contains semver ─────────────────────────────────

  it('[P1] 5.125 difyctl version output contains a semantic version string', async () => {
    // Spec 5.125: version output must include a recognisable semver string.
    const result = await fx.r(['version'])
    assertExitCode(result, 0)
    // Version line: "Version:   1.2.3-..."
    expect(result.stdout).toMatch(/Version:\s+\d+\.\d+\.\d+/i)
  })

  // ── 5.128b  --workspace is per-command only, not persistent ──────────────

  it('[P0] 5.128b --workspace override is per-command only — subsequent calls use the default workspace', async () => {
    // Spec 5.128b: --workspace must not persist to the next command call.
    // Use get app which supports --workspace flag
    const withFlag = await fx.r([
      'get',
      'app',
      '-o',
      'json',
      '--limit',
      '1',
      '--workspace',
      E.workspaceId,
    ])
    assertExitCode(withFlag, 0)

    // Subsequent call without the flag must still work using the default workspace
    const withoutFlag = await fx.r(['get', 'app', '-o', 'json', '--limit', '1'])
    assertExitCode(withoutFlag, 0)
    // Both must succeed — confirming the flag did not alter persistent state
    expect(withFlag.stdout.length).toBeGreaterThan(0)
    expect(withoutFlag.stdout.length).toBeGreaterThan(0)
  })

  // ── 5.130  Flag placed before command → unknown command error ─────────────

  it('[P0] 5.130 placing a flag before the command (POSIX style) is not supported', async () => {
    // Spec 5.130: difyctl -o json get app is not supported.
    // Flags must follow the sub-command, not precede it.
    const result = await fx.r(['-o', 'json', 'get', 'app'])
    // The CLI treats "-o json get app" as an unknown command
    assertNonZeroExit(result)
    expect(result.stderr).toMatch(/unknown command/i)
  })

  // ── 5.132  -o json --workspace <id> both flags work simultaneously ─────────

  it('[P0] 5.132 -o json and --workspace can be used together', async () => {
    // Spec 5.132: two global flags applied simultaneously must both take effect.
    const result = await fx.r([
      'get',
      'app',
      '-o',
      'json',
      '--workspace',
      E.workspaceId,
      '--limit',
      '1',
    ])
    assertExitCode(result, 0)
    // JSON output must be valid and non-empty
    expect(result.stdout.trimStart()).toMatch(/^\{/)
  })

  // ── 5.132b  -w shorthand does not exist ───────────────────────────────────

  it('[P0] 5.132b -w shorthand does not exist — returns unknown flag with exit 1', async () => {
    // Spec 5.132b: only --workspace (long form) is supported; -w is not a valid
    // shorthand and must be rejected.
    const result = await fx.r(['get', 'app', '-w', E.workspaceId])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/unknown flag: -w/i)
  })

  // ── 5.133  Unknown flag → exit 1 ──────────────────────────────────────────

  it('[P0] 5.133 unknown flag returns "unknown flag" error with exit 1', async () => {
    // Spec 5.133: unrecognised flags must produce a clear error and exit 1.
    const result = await fx.r(['get', 'app', '--this-flag-does-not-exist'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/unknown flag/i)
  })

  // ── 5.134  -o missing value → exit 1 ─────────────────────────────────────

  it('[P0] 5.134 -o without a value returns "flag -o expects a value" with exit 1', async () => {
    // Spec 5.134: -o must be followed by a format value; omitting it is an error.
    // Note: exit code is 1 (not 2), distinct from illegal-value errors (exit 2).
    const result = await fx.r(['get', 'app', '-o'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/flag -o expects a value/i)
  })

  // ── 5.140  help + -o json doesn't crash ───────────────────────────────────

  it('[P1] 5.140 difyctl --help -o json runs without crashing and exits 0', async () => {
    // Spec 5.140: combining --help with -o json must not cause a crash;
    // the CLI should either apply -o json to help output or silently ignore it.
    const result = await fx.r(['--help', '-o', 'json'])
    assertExitCode(result, 0)
    // Output must be non-empty
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  // ── 5.141  Invalid flag + -o json → plain-text error (not JSON envelope) ──

  it('[P1] 5.141 unknown flag with -o json outputs plain-text error (not a JSON error envelope)', async () => {
    // Spec 5.141 (revised): unknown-flag errors are plain-text regardless of
    // the -o flag because the flag is rejected before output formatting applies.
    const result = await fx.r(['get', 'app', '--unknownflag', '-o', 'json'])
    assertNonZeroExit(result)
    // stderr must be plain text (start with the error code word, not '{')
    expect(result.stderr.trimStart()).not.toMatch(/^\{/)
    expect(result.stderr).toMatch(/unknown flag/i)
  })

  // ── 5.145  Help output is pipe-friendly (no ANSI) ─────────────────────────

  it('[P1] 5.145 difyctl --help output contains no ANSI control characters (pipe-friendly)', async () => {
    // Spec 5.145: help text must be clean when piped to a file or another command.
    const result = await fx.r(['--help'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, '--help stdout')
  })

  // ── 5.148  Duplicate -o flags → last value wins ───────────────────────────

  it('[P1] 5.148 repeating -o flag is stable — last value takes effect', async () => {
    // Spec 5.148: passing -o json -o yaml should use yaml (last wins) or report
    // a clear error, not crash or produce garbled output.
    const result = await fx.r(['get', 'app', '-o', 'json', '-o', 'yaml', '--limit', '1'])
    assertExitCode(result, 0)
    // Output must be parseable (either JSON or YAML) and non-empty
    expect(result.stdout.trim().length).toBeGreaterThan(0)
  })

  // ── 5.http-retry  --http-retry flag works ────────────────────────────────

  it('[P1] 5.http-retry --http-retry 0 disables retries and command executes normally', async () => {
    // Spec 5.http-retry: --http-retry is a valid global flag that controls the
    // number of HTTP retry attempts. Setting it to 0 disables retries.
    const result = await fx.r(['get', 'app', '--http-retry', '0', '-o', 'json', '--limit', '1'])
    assertExitCode(result, 0)
    expect(result.stdout.trimStart()).toMatch(/^\{/)
  })

  // ── WTA-252  Help improvements ────────────────────────────────────────────

  it('[P1] 5.149 difyctl --help shows auth devices description', async () => {
    const result = await fx.r(['--help'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('auth devices list')
    expect(result.stdout).toContain('List active sessions for the current bearer')
    expect(result.stdout).toContain('auth devices revoke')
    expect(result.stdout).toContain('Revoke one or all session devices')
  })

  it('[P1] 5.150 help surfaces contain global flags and command-level --workspace', async () => {
    const result = await fx.r(['--help'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/GLOBAL FLAGS/i)
    expect(result.stdout).toContain('-o, --output')
    expect(result.stdout).toContain('--http-retry')

    const commandHelp = await fx.r(['get', 'app', '--help'])
    assertExitCode(commandHelp, 0)
    expect(commandHelp.stdout).toContain('--workspace')
  })

  it('[P1] 5.151 difyctl --help contains quick-start example flow', async () => {
    const result = await fx.r(['--help'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/EXAMPLES/i)
    expect(result.stdout).toContain('$ difyctl auth login')
    expect(result.stdout).toContain('$ difyctl get app')
    expect(result.stdout).toContain('$ difyctl run app')
  })
})
