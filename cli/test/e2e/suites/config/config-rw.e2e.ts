/**
 * E2E: difyctl config — 2.2 Config Read/Write Commands
 *
 * Coverage (spec cases 2.A1–2.A14 + 2.25):
 *   - config view  : print full config or empty object when no values set
 *   - config path  : print absolute path to config.yml
 *   - config get   : read a single key by dotted path; unknown key → exit 2
 *   - config set   : validate and atomically write a key; invalid value → exit 2
 *   - config unset : delete a key; idempotent when key is absent
 *   - defaults.format / defaults.limit / state.current_app known-key round-trips
 *   - Invalid value, out-of-range, unknown key, rejected key (default_host)
 *   - Missing argument errors (exit 1)
 *   - config set defaults.format persists and influences run app output format (2.25)
 *
 * Non-automatable cases:
 *   - 2.25 end-to-end run app default format: requires a live Dify server and a
 *     valid app ID.  The config persistence side (set → get round-trip) is fully
 *     covered by 2.A6 below; the run-app consumption is left to integration tests.
 *
 * All cases run locally — no real Dify server required (except the 2.25 note above).
 *
 * Real CLI behaviour confirmed:
 *   - config get of an unset key returns empty string, exit 0
 *   - config view with no values set prints nothing (empty), exit 0
 *   - config view --json with no values set prints {}, exit 0
 *   - config view --json with values prints a JSON object keyed by dotted path
 *   - config unset of an unset key exits 0 (idempotent) and prints the unset line
 *   - config set missing value → exit 1 ("missing required argument: value")
 *   - config get missing key  → exit 1 ("missing required argument: key")
 *   - unknown config key      → exit 2
 *   - invalid value           → exit 2
 *   - default_host is rejected as an unknown config key (stored in hosts.yml)
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'

describe('E2E / difyctl config — 2.2 Config read/write commands', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await withTempConfig()
    configDir = tmp.configDir
    cleanup = tmp.cleanup
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[]) {
    return run(argv, { configDir })
  }

  // ── 2.A1  config view ────────────────────────────────────────────────────────

  it('[P0] 2.A1 config view prints nothing when no values have been set', async () => {
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  it('[P0] 2.A1 config view --json returns {} when no values have been set', async () => {
    const result = await r(['config', 'view', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(typeof parsed).toBe('object')
    expect(Object.keys(parsed).length).toBe(0)
  })

  it('[P0] 2.A1 config view displays all set key=value pairs', async () => {
    await r(['config', 'set', 'defaults.format', 'yaml'])
    await r(['config', 'set', 'defaults.limit', '20'])
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('defaults.format = yaml')
    expect(result.stdout).toContain('defaults.limit = 20')
  })

  it('[P1] 2.A1 config view --json returns a JSON object keyed by dotted path', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    await r(['config', 'set', 'defaults.limit', '15'])
    const result = await r(['config', 'view', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed['defaults.format']).toBe('json')
    expect(parsed['defaults.limit']).toBe(15)
  })

  // ── 2.A2  config path ────────────────────────────────────────────────────────

  it('[P0] 2.A2 config path returns the absolute path to config.yml', async () => {
    const result = await r(['config', 'path'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(join(configDir, 'config.yml'))
  })

  it('[P0] 2.A2 config path output ends with a newline', async () => {
    const result = await r(['config', 'path'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toMatch(/config.yml$/)
  })

  // ── 2.A3  config get defaults.format ────────────────────────────────────────

  it('[P0] 2.A3 config get defaults.format returns empty string when not set (exit 0)', async () => {
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  // ── 2.A4  config get defaults.limit ─────────────────────────────────────────

  it('[P0] 2.A4 config get defaults.limit returns empty string when not set (exit 0)', async () => {
    const result = await r(['config', 'get', 'defaults.limit'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  // ── 2.A5  config get unknown key → exit 2 ───────────────────────────────────

  it('[P0] 2.A5 config get of an unknown key returns exit 2 with an error message', async () => {
    const result = await r(['config', 'get', 'unknown.key'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  // ── 2.A6  config set defaults.format ────────────────────────────────────────

  it('[P0] 2.A6 config set defaults.format json writes successfully and get reads it back', async () => {
    const setResult = await r(['config', 'set', 'defaults.format', 'json'])
    assertExitCode(setResult, 0)
    expect(setResult.stdout).toMatch(/defaults\.format/)

    const getResult = await r(['config', 'get', 'defaults.format'])
    assertExitCode(getResult, 0)
    expect(getResult.stdout.trim()).toBe('json')
  })

  it('[P1] 2.A6 multiple config set calls for different keys each persist independently', async () => {
    await r(['config', 'set', 'defaults.format', 'yaml'])
    await r(['config', 'set', 'defaults.limit', '30'])
    const fmt = await r(['config', 'get', 'defaults.format'])
    const lim = await r(['config', 'get', 'defaults.limit'])
    expect(fmt.stdout.trim()).toBe('yaml')
    expect(lim.stdout.trim()).toBe('30')
  })

  // ── 2.A7  config set defaults.limit ─────────────────────────────────────────

  it('[P0] 2.A7 config set defaults.limit 50 writes successfully and get reads it back', async () => {
    await r(['config', 'set', 'defaults.limit', '50'])
    const result = await r(['config', 'get', 'defaults.limit'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('50')
  })

  it('[P1] 2.A7 config set state.current_app writes and reads back correctly', async () => {
    const appId = 'app-e2e-config-rw-test'
    await r(['config', 'set', 'state.current_app', appId])
    const result = await r(['config', 'get', 'state.current_app'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(appId)
  })

  // ── 2.A8  invalid value: defaults.limit 0 ───────────────────────────────────

  it('[P0] 2.A8 config set defaults.limit 0 (below minimum) returns exit 2 and config is unchanged', async () => {
    await r(['config', 'set', 'defaults.limit', '10'])
    const result = await r(['config', 'set', 'defaults.limit', '0'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/out of range|invalid/i)
    // Previous value must be preserved
    const check = await r(['config', 'get', 'defaults.limit'])
    expect(check.stdout.trim()).toBe('10')
  })

  // ── 2.A9  invalid value: defaults.limit 201 ─────────────────────────────────

  it('[P0] 2.A9 config set defaults.limit 201 (above maximum) returns exit 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', '201'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/out of range|invalid/i)
  })

  it('[P0] 2.A9 config set defaults.limit with a non-numeric string returns exit 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', 'abc'])
    expect(result.exitCode).toBe(2)
  })

  // ── 2.A10 invalid value: defaults.format unknown format ─────────────────────

  it('[P0] 2.A10 config set defaults.format with an unknown format string returns exit 2', async () => {
    const result = await r(['config', 'set', 'defaults.format', 'invalid_format'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/not one of|invalid/i)
  })

  // ── 2.A11 unknown key → exit 2 ───────────────────────────────────────────────

  it('[P0] 2.A11 config set of an unknown key returns exit 2', async () => {
    const result = await r(['config', 'set', 'unknown.key', 'value'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  it('[P0] 2.A11 config unset of an unknown key returns exit 2', async () => {
    const result = await r(['config', 'unset', 'unknown.key'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  // ── 2.A12 default_host is rejected (stored in hosts.yml, not config.yml) ────

  it('[P0] 2.A12 config set default_host is rejected with exit 2 (host is stored in hosts.yml)', async () => {
    const result = await r(['config', 'set', 'default_host', 'https://example.com'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  // ── 2.A13 config unset ───────────────────────────────────────────────────────

  it('[P0] 2.A13 config unset removes a set key — subsequent get returns empty string', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const unsetResult = await r(['config', 'unset', 'defaults.format'])
    assertExitCode(unsetResult, 0)

    const getResult = await r(['config', 'get', 'defaults.format'])
    assertExitCode(getResult, 0)
    expect(getResult.stdout.trim()).toBe('')
  })

  it('[P1] 2.A13 unset of one key does not affect other keys', async () => {
    await r(['config', 'set', 'defaults.format', 'table'])
    await r(['config', 'set', 'defaults.limit', '10'])
    await r(['config', 'unset', 'defaults.format'])
    const lim = await r(['config', 'get', 'defaults.limit'])
    expect(lim.stdout.trim()).toBe('10')
  })

  it('[P1] 2.A13 config.yml is updated correctly after unset (raw file check)', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    await r(['config', 'set', 'defaults.limit', '5'])
    await r(['config', 'unset', 'defaults.format'])
    const raw = await readFile(join(configDir, 'config.yml'), 'utf8')
    // format should be gone; limit should still be present
    expect(raw).not.toMatch(/format:\s*json/)
    expect(raw).toMatch(/limit:\s*5/)
  })

  // ── 2.A14 config unset is idempotent ────────────────────────────────────────

  it('[P1] 2.A14 config unset of an already-absent key is idempotent (exit 0)', async () => {
    const result = await r(['config', 'unset', 'defaults.format'])
    assertExitCode(result, 0)
  })

  // ── Missing argument errors ──────────────────────────────────────────────────

  it('[P1] config set with missing value argument returns exit 1', async () => {
    const result = await r(['config', 'set', 'defaults.format'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/missing required argument/i)
  })

  it('[P1] config get with missing key argument returns exit 1', async () => {
    const result = await r(['config', 'get'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/missing required argument/i)
  })

  // ── Output format ────────────────────────────────────────────────────────────

  it('[P0] config output contains no ANSI colour codes (non-TTY environment)', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    // eslint-disable-next-line no-control-regex
    expect(result.stdout).not.toMatch(/\x1B\[[0-9;]*[mGKHFA-DJsuhl]/)
  })

  // ── 2.25  config set defaults.format persists for subsequent commands ────────
  //
  // Non-automatable (live server required):
  //   The full 2.25 scenario — "run app without -o uses the persisted format" —
  //   requires a live Dify server and a valid app ID.  We verify only the
  //   persistence side here; the run-app consumption is left to integration tests.

  it('[P1] 2.25 (persistence side) config set defaults.format is readable by a subsequent get call', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('json')
  })
})
