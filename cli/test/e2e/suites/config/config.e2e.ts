/**
 * E2E: difyctl config — configuration management
 *
 * Test cases sourced from: Dify CLI Enhanced spec
 *   - Dify CLI/Config/Initialization & Default Paths (26 cases, testable subset)
 *   - Dify CLI/Config/Environment Variable Override Priority (26 cases, testable subset)
 *
 * Covers sub-commands: config path / config get / config set / config unset / config view
 * All cases run purely locally — no real Dify server required.
 */

import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode, assertNoAnsi } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'

describe('E2E / difyctl config', () => {
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

  function r(argv: string[], extraEnv?: Record<string, string>) {
    return run(argv, { configDir, env: extraEnv })
  }

  // ── config path ──────────────────────────────────────────────────────────────

  it('[P0] config path returns the correct absolute path to config.yml', async () => {
    // Spec: default config path is correct
    const result = await r(['config', 'path'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(join(configDir, 'config.yml'))
  })

  it('[P0] config path output ends with a newline', async () => {
    const result = await r(['config', 'path'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/config\.yml\n$/)
  })

  // ── config set / get ─────────────────────────────────────────────────────────

  it('[P0] config set defaults.format writes successfully — stdout contains key=value', async () => {
    const result = await r(['config', 'set', 'defaults.format', 'json'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/defaults\.format/)
  })

  it('[P0] config get reads the previously written defaults.format', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('json')
  })

  it('[P0] config set defaults.limit writes and reads back correctly', async () => {
    await r(['config', 'set', 'defaults.limit', '50'])
    const result = await r(['config', 'get', 'defaults.limit'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('50')
  })

  it('[P0] config set state.current_app writes and reads back correctly', async () => {
    const appId = 'app-e2e-config-test'
    await r(['config', 'set', 'state.current_app', appId])
    const result = await r(['config', 'get', 'state.current_app'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(appId)
  })

  it('[P0] config get returns empty string for an unset key (exit 0)', async () => {
    // Spec: missing config fields fall back to default values
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  it('[P1] multiple config set calls for different keys each persist independently', async () => {
    // Spec: existing config is not overwritten when setting other keys
    await r(['config', 'set', 'defaults.format', 'yaml'])
    await r(['config', 'set', 'defaults.limit', '30'])
    const fmt = await r(['config', 'get', 'defaults.format'])
    const lim = await r(['config', 'get', 'defaults.limit'])
    expect(fmt.stdout.trim()).toBe('yaml')
    expect(lim.stdout.trim()).toBe('30')
  })

  // ── config unset ─────────────────────────────────────────────────────────────

  it('[P0] config unset clears a set key — get returns empty string', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    await r(['config', 'unset', 'defaults.format'])
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  it('[P1] config unset of an unset key is idempotent (exit 0)', async () => {
    const result = await r(['config', 'unset', 'defaults.format'])
    assertExitCode(result, 0)
  })

  it('[P1] other keys are unaffected after config unset', async () => {
    await r(['config', 'set', 'defaults.format', 'table'])
    await r(['config', 'set', 'defaults.limit', '10'])
    await r(['config', 'unset', 'defaults.format'])
    const lim = await r(['config', 'get', 'defaults.limit'])
    expect(lim.stdout.trim()).toBe('10')
  })

  // ── config view ──────────────────────────────────────────────────────────────

  it('[P0] config view outputs nothing for an empty configuration', async () => {
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  it('[P0] config view displays all set key = value pairs', async () => {
    await r(['config', 'set', 'defaults.format', 'yaml'])
    await r(['config', 'set', 'defaults.limit', '20'])
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('defaults.format = yaml')
    expect(result.stdout).toContain('defaults.limit = 20')
  })

  it('[P0] config view --json outputs valid JSON containing the set keys', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    await r(['config', 'set', 'defaults.limit', '15'])
    const result = await r(['config', 'view', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty('defaults.format', 'json')
    expect(parsed).toHaveProperty('defaults.limit', 15)
  })

  it('[P1] config view --json outputs a valid empty JSON object for an empty config', async () => {
    const result = await r(['config', 'view', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout)
    expect(typeof parsed).toBe('object')
  })

  // ── Initialization and default paths ─────────────────────────────────────────

  it('[P0] the first config set auto-creates the config directory and config.yml file', async () => {
    // Spec: config directory and file are auto-created on first use
    await r(['config', 'set', 'defaults.format', 'json'])
    await expect(access(join(configDir, 'config.yml'))).resolves.toBeUndefined()
  })

  it('[P0] config.yml file permissions are 0o600', async () => {
    // Spec: config file has correct default permissions
    await r(['config', 'set', 'defaults.format', 'json'])
    const info = await stat(join(configDir, 'config.yml'))
    expect(info.mode & 0o777).toBe(0o600)
  })

  it('[P0] config.yml contains the correct schema_version field', async () => {
    // Spec: config file has the correct default schema
    await r(['config', 'set', 'defaults.format', 'json'])
    const raw = await import('node:fs/promises').then(fs =>
      fs.readFile(join(configDir, 'config.yml'), 'utf8'),
    )
    expect(raw).toMatch(/schema_version/)
  })

  it('[P0] invalid YAML content in config returns a parse error', async () => {
    // Spec: invalid config content returns a parse error
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.yml'), ': broken: yaml: [[[', { mode: 0o600 })
    const result = await r(['config', 'get', 'defaults.format'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/parse|yaml|config/i)
  })

  it('[P0] schema_version higher than supported returns config_schema_unsupported error', async () => {
    // Spec: config with schema_version higher than supported returns an error
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'config.yml'),
      'schema_version: 999\ndefaults: {}\nstate: {}\n',
      { mode: 0o600 },
    )
    const result = await r(['config', 'get', 'defaults.format'])
    expect(result.exitCode).toBe(6) // VersionCompat
    expect(result.stderr).toMatch(/schema_version|unsupported|upgrade/i)
  })

  it('[P0] DIFY_CONFIG_DIR overrides the default path — config path returns the specified directory', async () => {
    // Spec: DIFY_CONFIG_DIR env var overrides the default path
    const altDir = await mkdtemp(join(tmpdir(), 'difyctl-alt-'))
    try {
      const result = await run(['config', 'path'], { configDir: altDir })
      assertExitCode(result, 0)
      expect(result.stdout.trim()).toBe(join(altDir, 'config.yml'))
    }
    finally {
      await rm(altDir, { recursive: true, force: true })
    }
  })

  it('[P0] a temporary DIFY_CONFIG_DIR does not modify the original config directory', async () => {
    // Spec: a temporary DIFY_CONFIG_DIR injection does not modify the original config
    await r(['config', 'set', 'defaults.format', 'yaml'])

    const altDir = await mkdtemp(join(tmpdir(), 'difyctl-alt-'))
    try {
      await run(['config', 'set', 'defaults.format', 'json'], { configDir: altDir })
      // The original configDir content must be unchanged
      const original = await r(['config', 'get', 'defaults.format'])
      expect(original.stdout.trim()).toBe('yaml')
    }
    finally {
      await rm(altDir, { recursive: true, force: true })
    }
  })

  // ── Error scenarios ──────────────────────────────────────────────────────────

  it('[P0] config get of an unknown key returns exit code 2', async () => {
    const result = await r(['config', 'get', 'unknown.key'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  it('[P0] config set of an unknown key returns exit code 2', async () => {
    const result = await r(['config', 'set', 'unknown.key', 'val'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  it('[P0] config unset of an unknown key returns exit code 2', async () => {
    const result = await r(['config', 'unset', 'unknown.key'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  it('[P0] config set defaults.format with an invalid value returns exit code 2', async () => {
    // Spec: config_invalid_value → usage error
    const result = await r(['config', 'set', 'defaults.format', 'not_a_format'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/defaults\.format|not one of/i)
  })

  it('[P0] config set defaults.limit 0 (below minimum) returns exit code 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', '0'])
    expect(result.exitCode).toBe(2)
  })

  it('[P0] config set defaults.limit 201 (above maximum) returns exit code 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', '201'])
    expect(result.exitCode).toBe(2)
  })

  it('[P0] config set defaults.limit with a non-numeric string returns exit code 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', 'abc'])
    expect(result.exitCode).toBe(2)
  })

  it('[P1] config set with missing value argument returns an error', async () => {
    const result = await r(['config', 'set', 'defaults.format'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument/i)
  })

  it('[P1] config get with missing key argument returns an error', async () => {
    const result = await r(['config', 'get'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument/i)
  })

  // ── Output format ────────────────────────────────────────────────────────────

  it('[P0] config output contains no ANSI colour (non-TTY environment)', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })

  it('[P0] config initialization/operations do not leak sensitive information (token/secret)', async () => {
    // Spec: config initialization logs do not leak sensitive information
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout + result.stderr).not.toMatch(/dfoa_|dfoe_|secret|password/i)
  })
})
