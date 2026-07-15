/**
 * E2E assertion helpers.
 *
 * These wrap vitest's `expect` with richer failure messages that include the
 * full stdout / stderr of the failing process — essential for debugging CI.
 */

import type { RunResult } from './cli.js'
import { expect } from 'vitest'
import './vitest-context.js'

// ── ANSI ──────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHFA-DJsuhl]/g

function redact(text: string): string {
  return text
    .replace(/\bBearer\s+[\w.-]+\b/g, 'Bearer [REDACTED]')
    .replace(/\bdfo[ae]_[\w-]+\b/g, 'dfo*_REDACTED')
}

// ── Exit code ─────────────────────────────────────────────────────────────

/**
 * Assert the exit code matches `expected`.
 * On failure, prints the full stdout and stderr so the cause is visible in CI.
 */
export function assertExitCode(result: RunResult, expected: number): void {
  if (result.exitCode !== expected) {
    process.stderr.write(
      `\n[E2E assertExitCode] expected ${expected}, got ${result.exitCode}\n` +
        `stdout:\n${redact(result.stdout) || '(empty)'}\n` +
        `stderr:\n${redact(result.stderr) || '(empty)'}\n`,
    )
  }
  expect(result.exitCode, `exit code should be ${expected}`).toBe(expected)
}

/**
 * Assert the exit code is NOT 0 (i.e. some error occurred).
 */
export function assertNonZeroExit(result: RunResult): void {
  expect(result.exitCode, 'exit code should be non-zero').not.toBe(0)
}

// ── Stdout / stderr content ───────────────────────────────────────────────

/**
 * Assert stdout is valid JSON and return the parsed value.
 */
export function assertJson<T = unknown>(result: RunResult): T {
  let parsed: T
  try {
    parsed = JSON.parse(result.stdout) as T
  } catch {
    throw new Error(
      `stdout is not valid JSON.\nstdout:\n${redact(result.stdout)}\nstderr:\n${redact(result.stderr)}`,
    )
  }
  return parsed
}

/**
 * Assert stderr contains a valid JSON error envelope of the shape:
 *   { error: { code: string, message: string, hint?: string } }
 *
 * @param result - The run result to inspect.
 * @param expectedCode - When provided, also asserts that error.code equals this value.
 *   Use the stable error codes from the CLI contract, e.g.:
 *   'not_logged_in', 'app_not_found', 'insufficient_scope', 'auth_expired'
 *
 * @example
 *   assertErrorEnvelope(result, 'not_logged_in')
 *   assertErrorEnvelope(result, 'app_not_found')
 */
export function assertErrorEnvelope(
  result: RunResult,
  expectedCode?: string,
): { error: { code: string; message: string; hint?: string } } {
  const raw = result.stderr.trim()
  let parsed: { error: { code: string; message: string; hint?: string } }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error(
      `stderr is not valid JSON.\nstdout:\n${redact(result.stdout)}\nstderr:\n${redact(result.stderr)}`,
    )
  }
  expect(parsed, 'stderr envelope missing "error" key').toHaveProperty('error')
  expect(parsed.error, 'error.code must be a non-empty string').toHaveProperty('code')
  expect(parsed.error, 'error.message must be a non-empty string').toHaveProperty('message')
  expect(typeof parsed.error.code, 'error.code must be a string').toBe('string')
  expect(parsed.error.code.length, 'error.code must be non-empty').toBeGreaterThan(0)
  if (expectedCode !== undefined) {
    expect(
      parsed.error.code,
      `error.code should be "${expectedCode}", got "${parsed.error.code}"\nstderr:\n${redact(result.stderr)}`,
    ).toBe(expectedCode)
  }
  return parsed
}

// ── ANSI / formatting ────────────────────────────────────────────────────

/**
 * Assert the given text contains no ANSI escape sequences.
 * Pass `label` to identify which stream failed (e.g. 'stdout', 'stderr').
 */
export function assertNoAnsi(text: string, label = 'output'): void {
  const clean = text.replace(ANSI_RE, '')
  expect(text, `${label} must not contain ANSI control codes`).toBe(clean)
}

/**
 * Assert stdout starts with `{` and ends with `\n` — the canonical format
 * for pipe-friendly JSON output.
 */
export function assertPipeFriendlyJson(result: RunResult): void {
  assertNoAnsi(result.stdout, 'stdout')
  expect(
    result.stdout.trimStart().startsWith('{') || result.stdout.trimStart().startsWith('['),
    'stdout should start with { or [ for pipe-friendly JSON',
  ).toBe(true)
  expect(result.stdout.endsWith('\n'), 'stdout should end with newline').toBe(true)
}

// ── stdout / stderr contains ──────────────────────────────────────────────

/**
 * Assert stdout contains the given substring, printing full output on failure.
 */
export function assertStdoutContains(result: RunResult, expected: string): void {
  if (!result.stdout.includes(expected)) {
    process.stderr.write(
      `\n[E2E assertStdoutContains] "${expected}" not found in stdout.\n` +
        `stdout:\n${redact(result.stdout)}\nstderr:\n${redact(result.stderr)}\n`,
    )
  }
  expect(result.stdout).toContain(expected)
}

/**
 * Assert stderr contains the given substring, printing full output on failure.
 */
export function assertStderrContains(result: RunResult, expected: string): void {
  if (!result.stderr.includes(expected)) {
    process.stderr.write(
      `\n[E2E assertStderrContains] "${expected}" not found in stderr.\n` +
        `stdout:\n${redact(result.stdout)}\nstderr:\n${redact(result.stderr)}\n`,
    )
  }
  expect(result.stderr).toContain(expected)
}
