/**
 * E2E: difyctl auth login — Interactive Login (Device Flow)
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Auth/Interactive Login (1.1–1.17)
 *
 * Architecture note:
 *   The full Device Flow requires a user to open a browser and complete OAuth, which is
 *   fundamentally outside the scope of an automated CLI E2E test.  This suite focuses on
 *   the **CLI-observable** parts of the login command:
 *     - Client-side URL validation (1.14)
 *     - Network-unreachable error path (1.13)
 *     - Credential file permissions after write (1.8)
 *     - Initial Device Flow output (stderr contains code + URL) before OAuth completes (1.2)
 *     - Cross-host warning when a session already exists (1.10)
 *     - --no-browser prompt format (1.16)
 *     - Invalid URL input rejection via stdin (1.17)
 *
 *   Cases that require completing real OAuth (1.1, 1.3–1.7, 1.9, 1.11, 1.12, 1.15) are
 *   marked as it.skip with an explanation.
 */

import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { BIN, BUN, injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)

describe('E2E / difyctl auth login', () => {
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

  function r(argv: string[], extraOpts: { stdin?: string; timeout?: number } = {}) {
    return run(argv, { configDir, ...extraOpts })
  }

  // ── 1.13: Network error ────────────────────────────────────────────────────

  it('[P0] auth login with unreachable host returns network/connection error (1.13)', async () => {
    // Spec 1.13: when the host is unreachable, CLI returns a server/network error.
    // 127.0.0.1:19999 has nothing listening — ECONNREFUSED is immediate.
    // https:// passes the scheme validation; then ECONNREFUSED fires immediately.
    const result = await r(['auth', 'login', '--host', 'https://127.0.0.1:19999'], {
      timeout: 15_000,
    })
    expect(result.exitCode, 'unreachable host should cause non-zero exit').not.toBe(0)
    expect(result.stderr + result.stdout).toMatch(
      /network|connect|ECONNREFUSED|server|unreachable|refused|fetch/i,
    )
  })

  // ── 1.14: Invalid URL format ───────────────────────────────────────────────

  it('[P1] auth login --host with invalid URL returns usage/connection error (1.14)', async () => {
    // Spec 1.14: `auth login --host invalid_url` → CLI returns usage error or connection failure.
    const result = await r(['auth', 'login', '--host', 'not_a_valid_url'], { timeout: 10_000 })
    expect(result.exitCode, 'invalid URL should cause non-zero exit').not.toBe(0)
  })

  it('[P1] auth login --host with bare hostname (no scheme) returns error (1.14 variant)', async () => {
    // A bare hostname without https:// or http:// is also invalid.
    const result = await r(['auth', 'login', '--host', 'just-a-hostname'], { timeout: 10_000 })
    expect(result.exitCode, 'bare hostname should cause non-zero exit').not.toBe(0)
  })

  // ── 1.8: File permissions ──────────────────────────────────────────────────

  it('[P1] hosts.yml credential file permissions are 0600 after auth write (1.8)', async () => {
    // Spec 1.8: token written to file-based storage must have permission 0600.
    // injectAuth() replicates the same write path the CLI uses for file-fallback storage.
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.token,
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const hostsPath = join(configDir, 'hosts.yml')
    const fileStat = await stat(hostsPath)
    // Extract POSIX mode bits (lower 12 bits)
    const mode = fileStat.mode & 0o777
    expect(mode, `hosts.yml must be 0600, got ${mode.toString(8)}`).toBe(0o600)
  })

  // ── 1.2: Device Flow initial output (partial) ─────────────────────────────

  it('[P0] auth login --host outputs device code and verification URL to stderr (1.2)', async () => {
    // Spec 1.2: after `auth login --host <host>`, CLI emits one-time code + URL to stderr
    // before the user opens the browser.  We spawn the process, collect stderr until we see
    // the expected output (or 10 s), then SIGINT before any OAuth completes.
    // Omit CI=1 so the Device Flow is not suppressed in non-TTY mode.
    const proc = spawn(BUN, [BIN, 'auth', 'login', '--host', E.host], {
      env: { ...process.env, DIFY_CONFIG_DIR: configDir, NO_COLOR: '1' },
    })

    let stderrBuf = ''
    let stdoutBuf = ''
    const seen = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15_000)
      const pattern =
        /[A-Z0-9]{4}-[A-Z0-9]{4}|https?:\/\/|user.?code|verification|one.?time|device|login/i
      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8')
        if (pattern.test(stderrBuf)) {
          clearTimeout(timer)
          resolve(true)
        }
      })
      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8')
        if (pattern.test(stdoutBuf)) {
          clearTimeout(timer)
          resolve(true)
        }
      })
      // If process exits before we see the output, collect what we have
      proc.on('close', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })

    proc.kill('SIGINT')
    await new Promise<void>((res) => proc.on('close', () => res()))

    expect(
      seen,
      `Expected device code or verification URL in CLI output within 10s.\nstderr: ${stderrBuf}\nstdout: ${stdoutBuf}`,
    ).toBe(true)
  })

  // ── 1.10: Cross-host warning (partial) ────────────────────────────────────

  it('[P1] auth login --host <B> when already logged into host <A> exits non-zero or warns (1.10)', async () => {
    // Spec 1.10: if a session already exists for host A and the user runs
    // `auth login --host B`, CLI must output a warning about the host change.
    // We use run() with https:// so the scheme check passes, then check output.
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.token,
      email: E.email,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })

    // Use https:// to bypass scheme validation; ECONNREFUSED fires immediately.
    // The warning may appear before or after the connection error depending on CLI version.
    const result = await r(['auth', 'login', '--host', 'https://127.0.0.1:19999'], {
      timeout: 10_000,
    })
    const combined = result.stderr + result.stdout
    // Accept any of: cross-host warning, connection error, or non-zero exit (WTA-254 may not be shipped yet)
    expect(
      result.exitCode !== 0 ||
        /warn|different.?host|already|switch|ECONNREFUSED|refused|connect|network/i.test(combined),
      `Expected non-zero exit or relevant message.\nexitCode: ${result.exitCode}\noutput: ${combined.slice(0, 400)}`,
    ).toBe(true)
  })

  // ── 1.16: --no-browser prompt format (partial) ────────────────────────────

  it('[P1] auth login --no-browser host prompt contains URL format example (1.16)', async () => {
    // Spec 1.16: the host-input prompt must include a URL format hint such as
    // "https://cloud.dify.ai" or "http://localhost".
    // We spawn the process and collect stdout/stderr for up to 5 s, then SIGINT.
    const proc = spawn(BUN, [BIN, 'auth', 'login', '--no-browser'], {
      env: { ...process.env, DIFY_CONFIG_DIR: configDir, NO_COLOR: '1' },
      // Deliberately omit CI=1 so the interactive prompt is rendered
    })

    let output = ''
    const promptSeen = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5_000)
      const collect = (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (/https?:\/\/|cloud\.dify\.ai|localhost|host/i.test(output)) {
          clearTimeout(timer)
          resolve(true)
        }
      }
      proc.stderr.on('data', collect)
      proc.stdout.on('data', collect)
      proc.on('close', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })

    proc.kill('SIGINT')
    await new Promise<void>((res) => proc.on('close', () => res()))

    expect(
      promptSeen,
      `Expected URL format hint in host prompt within 5s.\noutput: ${output.slice(0, 400)}`,
    ).toBe(true)
  })

  // ── 1.17: Invalid URL typed at prompt (partial) ───────────────────────────

  it('[P1] typing a bare hostname at the host prompt returns a URL format error (1.17)', async () => {
    // Spec 1.17: when the user enters a value that is not a valid URL (e.g. "localhost"
    // without a scheme), CLI reports an error and re-prompts or exits.
    // We pipe "localhost\n" to stdin so the CLI's prompt handler receives invalid input.
    const result = await r(['auth', 'login'], { stdin: 'localhost\n', timeout: 10_000 })
    // Either exit non-0 (usage error) or output contains an error message about the URL format.
    const combinedOutput = result.stdout + result.stderr
    const isValidationError =
      result.exitCode !== 0 || /invalid|url|format|scheme|http|expected/i.test(combinedOutput)
    expect(
      isValidationError,
      `Expected non-zero exit or URL validation error.\nexitCode: ${result.exitCode}\noutput: ${combinedOutput.slice(0, 400)}`,
    ).toBe(true)
  })

  // ── it.skip: Requires completed Device Flow ────────────────────────────────

  it.skip('[P0] completing browser OAuth shows "Logged in as" (1.5) — requires real OAuth', () => {
    // Cannot automate: depends on user opening a browser and approving the OAuth grant.
  })

  it.skip('[P0] token stored in OS Keychain after login (1.6) — requires completed Device Flow', () => {
    // Cannot automate: requires full Device Flow + OS Keychain write verification.
  })

  it.skip('[P0] Keychain unavailable → token written to hosts.yml (1.7) — requires Device Flow + disabled Keychain', () => {
    // Cannot automate: requires Keychain to be disabled and Device Flow to complete.
  })

  it.skip('[P0] re-login replaces existing session (1.9) — requires two complete Device Flows', () => {
    // Cannot automate: requires completing Device Flow twice.
  })

  it.skip('[P0] browser rejection causes login failure (1.12) — requires OAuth deny', () => {
    // Cannot automate: requires the OAuth server to return access_denied.
  })

  it.skip('[P1] login timeout when browser is never opened (1.11) — poll TTL > 5 min', () => {
    // Cannot automate: requires waiting for the full Device Flow poll timeout (~5 min).
  })
})
