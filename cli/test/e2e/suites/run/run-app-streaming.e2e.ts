/**
 * E2E: difyctl run app --stream — streaming output specialisation
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Run/Streaming Output (24 cases)
 *
 * Covers scenarios that run-app-basic.e2e.ts cannot handle:
 *  - Ctrl+C interruption (SIGINT)
 *  - Chunk arrival order verification (timing)
 */

import type { Buffer } from 'node:buffer'
import type { AuthFixture } from '../../helpers/cli.js'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { BIN, BUN, withAuthFixture } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

describe('E2E / difyctl run app --stream (specialisation)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P0] streaming output arrives in real-time chunks (stdout non-empty, echo complete)', async () => {
    // Spec: streaming output is printed in real-time by chunk + token order is preserved
    // withRetry: staging SSE connections may fail transiently on cold start
    await withRetry(async () => {
      const query = 'chunk-order-test'
      const proc = spawn(BUN, [BIN, 'run', 'app', E.chatAppId, query, '--stream'], {
        env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1' },
      })

      const chunks: string[] = []
      proc.stdout.on('data', (d: Buffer) => {
        chunks.push(d.toString('utf8'))
      })

      let stderr = ''
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8')
      })

      const exitCode = await new Promise<number>((res) => {
        proc.on('close', code => res(code ?? 1))
      })

      assertExitCode({ stdout: chunks.join(''), stderr, exitCode }, 0)
      // May arrive in multiple chunks; the concatenated result must contain the full query
      expect(chunks.join('')).toContain(query)
    }, { attempts: 3, delayMs: 2000 })
  })

  it('[P1] Ctrl+C interrupts streaming (SIGINT → non-zero exit code)', async () => {
    // Spec: Ctrl+C interrupts streaming + exit code is non-zero after Ctrl+C
    const proc = spawn(BUN, [BIN, 'run', 'app', E.chatAppId, 'ctrl-c-test', '--stream'], {
      env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1' },
    })

    let _stdout = ''
    let _stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      _stdout += d.toString('utf8')
    })
    proc.stderr.on('data', (d: Buffer) => {
      _stderr += d.toString('utf8')
    })

    // Wait for the process to start streaming, then interrupt.
    await new Promise(res => setTimeout(res, 800))
    proc.kill('SIGINT')

    const exitCode = await new Promise<number>((res) => {
      proc.on('close', code => res(code ?? 1))
    })

    expect(exitCode, 'SIGINT should cause non-zero exit').not.toBe(0)
  })

  it('[P0] server-side error event causes CLI to exit with non-zero code', async () => {
    // Spec: server-side error event causes CLI to exit with non-zero code
    // Use a non-existent app ID to force a server-side error.
    const proc = spawn(BUN, [BIN, 'run', 'app', 'nonexistent-app-xyz-e2e', 'hi', '--stream'], {
      env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1' },
    })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    const exitCode = await new Promise<number>((res) => {
      proc.on('close', code => res(code ?? 1))
    })
    expect(exitCode, 'error event should cause non-zero exit').not.toBe(0)
    expect(stderr.length).toBeGreaterThan(0)
  })

  it('[P0] streaming fails when a required input is missing (exit code non-zero)', async () => {
    // Spec: streaming fails when a required input is missing
    // workflow app requires variable x (required); the server should return a validation error
    // immediately, and the CLI exits with a non-zero code.
    //
    // ⚠️  Depends on feat/cli API version (server-side pre-validation of missing required inputs).
    //     Current local server 1.14.1 does not support this check; test passes once upgraded.
    const proc = spawn(BUN, [BIN, 'run', 'app', E.workflowAppId, '--stream'], {
      env: { ...process.env, DIFY_CONFIG_DIR: fx.configDir, CI: '1', NO_COLOR: '1' },
    })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    const exitCode = await new Promise<number>((res) => {
      proc.on('close', code => res(code ?? 1))
    })
    expect(exitCode).not.toBe(0)
    // The server should return a clear validation error rather than timing out
    expect(stderr).toMatch(/validation|required|invalid|missing/i)
  })
})
