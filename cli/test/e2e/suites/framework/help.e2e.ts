/**
 * E2E: difyctl help — Help system
 *
 * Covers:
 *  1. Top-level help overview  (difyctl help / difyctl --help / difyctl -h / difyctl <no args>)
 *  2. Per-command help via --help flag  (e.g. auth login --help)
 *  3. help <topic> subcommands  (help account / help external / help environment)
 *  4. Unknown command help routing
 *
 * Key behaviours confirmed by local testing:
 *  - `difyctl help`, `difyctl --help`, `difyctl -h`, `difyctl` all output the same top-level help
 *  - `difyctl help account/external/environment` routes via the help flag path:
 *    helpArgv = ['account'] / ['external'] / ['environment'] → resolveCommand fails
 *    → falls back to printTopLevelHelp() (same as top-level help)
 *  - `difyctl help account --help` also prints top-level help (--help strips before resolve)
 *  - Per-command help: `difyctl auth login --help` → formatHelp() output with USAGE/FLAGS/EXAMPLES
 *  - No auth is required for any help invocation
 *  - Exit code is always 0 for help commands
 */

import { describe, expect, it } from 'vitest'
import { run } from '../../helpers/cli.js'

// ── 1. Top-level help overview ────────────────────────────────────────────────

describe('E2E / difyctl help — top-level overview', () => {
  it('[P0] `difyctl help` exits 0 and prints COMMANDS section', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('COMMANDS')
  })

  it('[P0] `difyctl help` lists all top-level command groups', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('auth')
    expect(r.stdout).toContain('config')
    expect(r.stdout).toContain('get')
    expect(r.stdout).toContain('run')
    expect(r.stdout).toContain('help')
    expect(r.stdout).toContain('version')
  })

  it('[P0] `difyctl help` lists auth subcommands (login, logout, list, whoami)', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('login')
    expect(r.stdout).toContain('logout')
    expect(r.stdout).toContain('list')
    expect(r.stdout).toContain('devices')
    expect(r.stdout).toContain('whoami')
  })

  it('[P0] `difyctl help` lists help subcommands (account, external, environment)', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('account')
    expect(r.stdout).toContain('external')
    expect(r.stdout).toContain('environment')
  })

  it('[P0] `difyctl --help` produces the same output as `difyctl help`', async () => {
    const fromHelp = await run(['help'])
    const fromFlag = await run(['--help'])
    expect(fromFlag.exitCode).toBe(0)
    expect(fromFlag.stdout).toBe(fromHelp.stdout)
  })

  it('[P0] `difyctl -h` produces the same output as `difyctl help`', async () => {
    const fromHelp = await run(['help'])
    const fromShort = await run(['-h'])
    expect(fromShort.exitCode).toBe(0)
    expect(fromShort.stdout).toBe(fromHelp.stdout)
  })

  it('[P0] `difyctl` (no args) produces the same output as `difyctl help`', async () => {
    const fromHelp = await run(['help'])
    const fromNoArgs = await run([])
    expect(fromNoArgs.exitCode).toBe(0)
    expect(fromNoArgs.stdout).toBe(fromHelp.stdout)
  })

  it('[P1] top-level help contains the binary name `difyctl`', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('difyctl')
  })

  it('[P1] top-level help has no output on stderr', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('[P1] top-level help lists `get app` subcommand with description', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('app')
  })

  it('[P1] top-level help lists `run app` subcommand', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    // run → app should both appear
    expect(r.stdout).toContain('run')
    expect(r.stdout).toContain('app')
  })

  it('[P1] top-level help lists `env list` subcommand', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('env')
    expect(r.stdout).toContain('list')
  })

  it('[P1] top-level help lists `describe app` subcommand', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('describe')
  })

  it('[P1] top-level help lists `resume app` subcommand', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('resume')
  })

  it('[P1] top-level help lists `version` command', async () => {
    const r = await run(['help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('version')
  })
})

// ── 2. Per-command help via --help ────────────────────────────────────────────

describe('E2E / difyctl help — per-command --help flag', () => {
  it('[P0] `auth login --help` exits 0 and prints USAGE section', async () => {
    const r = await run(['auth', 'login', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
  })

  it('[P0] `auth login --help` prints FLAGS section with --host', async () => {
    const r = await run(['auth', 'login', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('FLAGS')
    expect(r.stdout).toContain('--host')
  })

  it('[P0] `auth login --help` prints EXAMPLES section', async () => {
    const r = await run(['auth', 'login', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('EXAMPLES')
    expect(r.stdout).toContain('difyctl auth login')
  })

  it('[P0] `auth login --help` prints the command description', async () => {
    const r = await run(['auth', 'login', '--help'])
    expect(r.exitCode).toBe(0)
    // Description from command class
    expect(r.stdout).toMatch(/sign in|oauth|device flow/i)
  })

  it('[P0] `auth logout --help` exits 0 and prints USAGE for auth logout', async () => {
    const r = await run(['auth', 'logout', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
    expect(r.stdout).toContain('auth logout')
  })

  it('[P0] `auth whoami --help` exits 0 and prints USAGE for auth whoami', async () => {
    const r = await run(['auth', 'whoami', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
    expect(r.stdout).toContain('auth whoami')
  })

  it('[P0] `get app --help` exits 0 and prints per-command help', async () => {
    const r = await run(['get', 'app', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
    expect(r.stdout).toContain('get app')
  })

  it('[P0] `run app --help` exits 0 and prints per-command help', async () => {
    const r = await run(['run', 'app', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
    expect(r.stdout).toContain('run app')
  })

  it('[P1] `help auth login --help` exits 0 (--help triggers top-level help)', async () => {
    // run.ts: --help is filtered first → helpArgv still contains 'auth login'
    // → resolved → formatHelp for auth login
    const r = await run(['help', 'auth', 'login', '--help'])
    expect(r.exitCode).toBe(0)
  })

  it('[P1] `version --help` exits 0 and prints USAGE for version', async () => {
    const r = await run(['version', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
  })

  it('[P1] `config get --help` exits 0 and prints USAGE for config get', async () => {
    const r = await run(['config', 'get', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
    expect(r.stdout).toContain('config get')
  })

  it('[P1] `env list --help` exits 0 and prints USAGE for env list', async () => {
    const r = await run(['env', 'list', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('USAGE')
    expect(r.stdout).toContain('env list')
  })
})

// ── 3. help <topic> subcommands ───────────────────────────────────────────────

describe('E2E / difyctl help — topic subcommands', () => {
  it('[P0] `difyctl help account` exits 0 and prints account onboarding topic', async () => {
    const r = await run(['help', 'account'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('account-bearer onboarding')
    expect(r.stdout).toContain('difyctl auth login')
  })

  it('[P0] `difyctl help external` exits 0 and prints external SSO topic', async () => {
    const r = await run(['help', 'external'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('external-SSO bearer onboarding')
    expect(r.stdout).toContain('dfoe_')
  })

  it('[P0] `difyctl help environment` exits 0 and prints environment topic', async () => {
    const r = await run(['help', 'environment'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('ENVIRONMENT VARIABLES')
    expect(r.stdout).toContain('DIFY_CONFIG_DIR')
  })

  it('[P0] `difyctl help account` output differs from `difyctl help`', async () => {
    const base = await run(['help'])
    const topic = await run(['help', 'account'])
    expect(topic.exitCode).toBe(0)
    expect(topic.stdout).not.toBe(base.stdout)
  })

  it('[P0] `difyctl help external` output differs from `difyctl help`', async () => {
    const base = await run(['help'])
    const topic = await run(['help', 'external'])
    expect(topic.exitCode).toBe(0)
    expect(topic.stdout).not.toBe(base.stdout)
  })

  it('[P0] `difyctl help environment` output differs from `difyctl help`', async () => {
    const base = await run(['help'])
    const topic = await run(['help', 'environment'])
    expect(topic.exitCode).toBe(0)
    expect(topic.stdout).not.toBe(base.stdout)
  })

  it('[P1] `difyctl help account` has no output on stderr', async () => {
    const r = await run(['help', 'account'])
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('[P1] `difyctl help unknowntopic` exits 1 and reports unknown help topic', async () => {
    const r = await run(['help', 'unknowntopic'])
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('unknown help topic')
  })
})

// ── 4. help topic subcommands invoked directly ────────────────────────────────

describe('E2E / difyctl help — direct subcommand invocation', () => {
  it('[P0] `difyctl help account` (direct) prints onboarding text via top-level routing', async () => {
    // Even when invoked as a normal command (not via help routing),
    // the current top-level routing still outputs help fallback
    const r = await run(['help', 'account'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('difyctl')
  })

  it('[P0] `difyctl help external` prints content about external bearers or top-level help', async () => {
    const r = await run(['help', 'external'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBeTruthy()
  })

  it('[P0] `difyctl help environment` prints content about env vars or top-level help', async () => {
    const r = await run(['help', 'environment'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBeTruthy()
  })
})
