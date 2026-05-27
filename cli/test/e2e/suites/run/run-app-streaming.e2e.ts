/**
 * E2E: difyctl run app --stream — Streaming 输出专项
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/Streaming 输出（24 条）
 *
 * 补充覆盖 run-app-basic.e2e.ts 无法完成的场景：
 *  - Ctrl+C 中断（SIGINT）
 *  - streaming 输出按 chunk 到达顺序验证（时序）
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

describe('E2E / difyctl run app --stream (专项)', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  it('[P0] streaming 输出按 chunk 实时到达（stdout 非空，echo 完整）', async () => {
    // 文档用例：streaming 输出按 chunk 实时打印 + streaming 输出保留 token 顺序
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
      // 可能分多个 chunk 到达，拼接后应包含完整 query
      expect(chunks.join('')).toContain(query)
    }, { attempts: 3, delayMs: 2000 })
  })

  it('[P1] Ctrl+C 可中断 streaming（SIGINT → exit code 非 0）', async () => {
    // 文档用例：Ctrl+C 可中断 streaming + Ctrl+C 后 exit code 非 0
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

  it('[P0] streaming 服务端返回 error event — CLI 以非 0 退出', async () => {
    // 文档用例：streaming 服务端返回 error event
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

  it('[P0] streaming 必填 input 缺失时失败（exit code 非 0）', async () => {
    // 文档用例：streaming 必填 input 缺失时失败
    // workflow app 需要 x 变量（required），不传时服务端应立即返回 validation error，
    // CLI 捕获后以非 0 exit code 退出。
    //
    // ⚠️  依赖 feat/cli API 版本（服务端对缺失 required input 做前置校验）。
    //     当前本地服务端 1.14.1 不支持此校验，用例在升级后方可真正通过。
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
    // 服务端应返回明确的 validation error，而非超时
    expect(stderr).toMatch(/validation|required|invalid|missing/i)
  })
})
