/**
 * E2E: difyctl config — 2.1 Config Initialisation & Paths
 *
 * Coverage (spec cases 2.1–2.26):
 *   - Auto-creation of the config directory and config.yml
 *   - Default path convention (verified via DIFY_CONFIG_DIR)
 *   - File permissions (0600)
 *   - config schema_version field
 *   - Existing config is not overwritten on re-init
 *   - Error handling: invalid YAML, empty file, schema_version too high
 *   - DIFY_CONFIG_DIR env var overrides the default path
 *   - Recursive creation of parent directories
 *   - Error behaviour when config dir/file is not writable/readable
 *   - Recovery after repairing a corrupted config
 *   - No sensitive information leaked when init fails
 *
 * Non-automatable cases:
 *   - 2.4 macOS default path: depends on real OS XDG behaviour; E2E forces DIFY_CONFIG_DIR,
 *     making it impossible to test the "no env var" system-default path scenario.
 *   - 2.5 Linux default path: same reason as 2.4.
 *   - 2.6 Windows default path: only verifiable on Windows; not covered by current CI.
 *   - 2.16 Unset HOME: behaviour is unstable on macOS/Linux when HOME is missing
 *     (Bun/Node may crash instead of returning a clean error).
 *   - 2.21 Concurrent config init: race conditions cannot be reliably simulated at the E2E layer.
 *
 * All cases run locally — no real Dify server required.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'

describe('E2E / difyctl config — 2.1 Config initialisation & paths', () => {
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

  // ── 2.1 Auto-create config directory ─────────────────────────────────────

  it('[P0] 2.1 first config set auto-creates the config directory', async () => {
    // Remove configDir then run config set — the directory must be recreated.
    await rm(configDir, { recursive: true, force: true })
    const result = await r(['config', 'set', 'defaults.format', 'json'])
    assertExitCode(result, 0)
    // Directory must now exist.
    const info = await stat(configDir)
    expect(info.isDirectory()).toBe(true)
  })

  // ── 2.2 Auto-generate config.yml ─────────────────────────────────────────

  it('[P0] 2.2 first config set auto-generates config.yml', async () => {
    const configFile = join(configDir, 'config.yml')
    // Ensure the file does not exist yet.
    await rm(configFile, { force: true })
    const result = await r(['config', 'set', 'defaults.format', 'json'])
    assertExitCode(result, 0)
    const info = await stat(configFile)
    expect(info.isFile()).toBe(true)
  })

  // ── 2.3 config.yml lives at the expected path ──────────────────────────────

  it('[P0] 2.3 config path returns the config.yml path inside configDir', async () => {
    const result = await r(['config', 'path'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(join(configDir, 'config.yml'))
  })

  // 2.4 macOS / 2.5 Linux / 2.6 Windows — platform default path
  // Not automatable: E2E forces DIFY_CONFIG_DIR, so the system default path cannot be tested.
  // Manual verification: run difyctl config path without DIFY_CONFIG_DIR and confirm the OS-specific path.

  // ── 2.7 config schema is valid ─────────────────────────────────────────────

  it('[P0] 2.7 config.yml contains a valid schema_version field', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const raw = await readFile(join(configDir, 'config.yml'), 'utf8')
    expect(raw).toMatch(/schema_version:\s*\d+/)
  })

  // ── 2.8 File permissions are 0600 ──────────────────────────────────────────

  it('[P0] 2.8 config.yml file permissions are 0600', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const info = await stat(join(configDir, 'config.yml'))
    expect(info.mode & 0o777).toBe(0o600)
  })

  // ── 2.9 Parent directories are created recursively ──────────────────────────

  it('[P1] 2.9 config set creates parent directories recursively when they do not exist', async () => {
    const nested = join(configDir, 'a', 'b', 'c')
    // The nested directory does not exist yet.
    const result = await run(['config', 'set', 'defaults.format', 'json'], { configDir: nested })
    assertExitCode(result, 0)
    const info = await stat(join(nested, 'config.yml'))
    expect(info.isFile()).toBe(true)
    await rm(nested, { recursive: true, force: true })
  })

  // ── 2.10 Existing config is not overwritten on re-init ───────────────────

  it('[P0] 2.10 existing config content is not overwritten on re-initialisation', async () => {
    await r(['config', 'set', 'defaults.format', 'yaml'])
    // Trigger the init path again by running another command.
    await r(['config', 'path'])
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('yaml')
  })

  // ── 2.11 Invalid YAML returns a parse error ─────────────────────────────

  it('[P0] 2.11 invalid YAML in config.yml returns a parse error (exit non-0)', async () => {
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.yml'), ': broken: yaml: [[[', { mode: 0o600 })
    const result = await r(['config', 'get', 'defaults.format'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/parse|yaml|config/i)
  })

  // ── 2.12 Empty config file ───────────────────────────────────────────────

  it('[P1] 2.12 empty config.yml is handled gracefully (exit 0, treated as no config)', async () => {
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.yml'), '', { mode: 0o600 })
    const result = await r(['config', 'get', 'defaults.format'])
    // Empty file is treated as no config; get returns empty value with exit 0.
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  // ── 2.13 Missing fields fall back to defaults ───────────────────────────

  it('[P1] 2.13 missing fields in config.yml fall back to built-in defaults', async () => {
    await mkdir(configDir, { recursive: true })
    // Write only schema_version, omit the defaults section.
    await writeFile(join(configDir, 'config.yml'), 'schema_version: 1\n', { mode: 0o600 })
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    // Missing field returns empty string (built-in default).
    expect(result.stdout.trim()).toBe('')
  })

  // ── 2.14 Config directory is not writable ───────────────────────────────

  it('[P0] 2.14 config set returns an error when the config directory is not writable (exit non-0)', async () => {
    await mkdir(configDir, { recursive: true })
    // Remove write permission from the config directory.
    const { chmod } = await import('node:fs/promises')
    await chmod(configDir, 0o555)
    try {
      const result = await r(['config', 'set', 'defaults.format', 'json'])
      expect(result.exitCode).not.toBe(0)
    }
    finally {
      await chmod(configDir, 0o755)
    }
  })

  // ── 2.15 Read-only config file can still be read ────────────────────────

  it('[P1] 2.15 CLI can read config.yml when it is read-only (exit 0)', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const { chmod } = await import('node:fs/promises')
    await chmod(join(configDir, 'config.yml'), 0o444)
    try {
      const result = await r(['config', 'get', 'defaults.format'])
      assertExitCode(result, 0)
      expect(result.stdout.trim()).toBe('json')
    }
    finally {
      await chmod(join(configDir, 'config.yml'), 0o600)
    }
  })

  // 2.16 Unset HOME environment variable
  // Not automatable: process behaviour is unstable when HOME is missing on macOS/Linux
  // (Node may crash), and DIFY_CONFIG_DIR injection makes HOME irrelevant in E2E context.

  // ── 2.17 XDG_CONFIG_HOME override ───────────────────────────────────────

  it.skip('[P0] 2.17 XDG_CONFIG_HOME override — skip: CLI does not yet support XDG_CONFIG_HOME', async () => {
    // When XDG_CONFIG_HOME is set, the config directory should be $XDG_CONFIG_HOME/difyctl.
    const xdgDir = join(configDir, 'xdg_home')
    await mkdir(xdgDir, { recursive: true })
    const expectedDir = join(xdgDir, 'difyctl')
    const result = await run(['config', 'path'], {
      env: { XDG_CONFIG_HOME: xdgDir },
    })
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(join(expectedDir, 'config.yml'))
  })

  // ── 2.18 DIFY_CONFIG_DIR overrides the default path ──────────────────────

  it('[P0] 2.18 DIFY_CONFIG_DIR specifies a custom config directory and CLI uses it', async () => {
    const altDir = join(configDir, 'custom_config')
    await mkdir(altDir, { recursive: true })
    const result = await run(['config', 'path'], { configDir: altDir })
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(join(altDir, 'config.yml'))
  })

  // ── 2.19 DIFY_CONFIG_DIR path is created when it does not exist ──────────

  it('[P1] 2.19 config set auto-creates the directory when DIFY_CONFIG_DIR does not exist', async () => {
    const newDir = join(configDir, 'nonexistent_dir')
    // Confirm the directory does not exist before the test.
    await rm(newDir, { recursive: true, force: true })
    const result = await run(['config', 'set', 'defaults.format', 'json'], { configDir: newDir })
    assertExitCode(result, 0)
    const info = await stat(join(newDir, 'config.yml'))
    expect(info.isFile()).toBe(true)
  })

  // ── 2.20 Config file is not readable ────────────────────────────────────

  it('[P0] 2.20 CLI returns an error when config.yml is not readable (exit non-0)', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const { chmod } = await import('node:fs/promises')
    await chmod(join(configDir, 'config.yml'), 0o000)
    try {
      const result = await r(['config', 'get', 'defaults.format'])
      expect(result.exitCode).not.toBe(0)
    }
    finally {
      await chmod(join(configDir, 'config.yml'), 0o600)
    }
  })

  // 2.21 Concurrent config initialisation
  // Not automatable: multi-process write races cannot be reliably simulated at the E2E layer.

  // ── 2.22 Init failure exits with non-zero ────────────────────────────────

  it('[P1] 2.22 config set exits with a non-zero code when initialisation fails', async () => {
    await mkdir(configDir, { recursive: true })
    const { chmod } = await import('node:fs/promises')
    await chmod(configDir, 0o555)
    try {
      const result = await r(['config', 'set', 'defaults.format', 'json'])
      expect(result.exitCode).not.toBe(0)
    }
    finally {
      await chmod(configDir, 0o755)
    }
  })

  // ── 2.23 Failure does not leak sensitive data ────────────────────────────

  it('[P0] 2.23 stderr does not contain tokens or secrets when config parsing fails', async () => {
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.yml'), ': broken: yaml: [[[', { mode: 0o600 })
    const result = await r(['config', 'get', 'defaults.format'])
    const combined = result.stdout + result.stderr
    expect(combined).not.toMatch(/dfoa_|dfoe_|secret|password/i)
  })

  // ── 2.24 Recovery after repairing a corrupted config ─────────────────────

  it('[P1] 2.24 CLI resumes normal operation after a corrupted config.yml is repaired', async () => {
    await mkdir(configDir, { recursive: true })
    // First write invalid content to simulate a corrupted config.
    await writeFile(join(configDir, 'config.yml'), ': broken: yaml: [[[', { mode: 0o600 })
    const broken = await r(['config', 'get', 'defaults.format'])
    expect(broken.exitCode).not.toBe(0)

    // Repair: overwrite with valid content.
    await writeFile(
      join(configDir, 'config.yml'),
      'schema_version: 1\ndefaults:\n  format: json\nstate: {}\n',
      { mode: 0o600 },
    )
    const fixed = await r(['config', 'get', 'defaults.format'])
    assertExitCode(fixed, 0)
    expect(fixed.stdout.trim()).toBe('json')
  })

  // ── 2.26 schema_version too high → config_schema_unsupported ─────────────

  it('[P0] 2.26 a future schema_version returns a config_schema_unsupported error', async () => {
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'config.yml'),
      'schema_version: 999\ndefaults: {}\nstate: {}\n',
      { mode: 0o600 },
    )
    const result = await r(['config', 'get', 'defaults.format'])
    expect(result.exitCode).toBe(6)
    expect(result.stderr).toMatch(/schema_version|unsupported|upgrade/i)
  })
})
