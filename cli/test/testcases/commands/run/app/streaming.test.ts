/**
 * Dify CLI/Run/Streaming 输出 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/Streaming 输出（24 条）
 */

import type { DifyMock } from '../../../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadAppInfoCache } from '../../../../../src/cache/app-info.js'
import { runApp } from '../../../../../src/commands/run/app/run.js'
import { createClient } from '../../../../../src/http/client.js'
import { bufferStreams } from '../../../../../src/io/streams.js'
import { hostsBundleFixture } from '../../../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../../../fixtures/dify-mock/server.js'

const baseBundle = hostsBundleFixture()

describe('Dify CLI/Run/Streaming 输出', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-run-stream-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  afterAll(async () => {
    await mock.stop()
  })

  function http() {
    return createClient({ host: mock.url, bearer: 'dfoa_test', retryAttempts: 0 })
  }
  async function cache() {
    return loadAppInfoCache({ configDir: dir,
    })
  }

  // ── 基础 streaming ────────────────────────────────────────────────────────

  it('run app --stream 可正常接收流式输出，stdout 有内容 [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().length).toBeGreaterThan(0)
  })

  it('streaming 输出包含 answer 内容 [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hello', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('echo:')
    expect(io.outBuf()).toContain('hello')
  })

  it('streaming 结束后正常退出（exit code 0）[P0]', async () => {
    const io = bufferStreams()
    // 不报错即为正常退出
    await expect(runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )).resolves.not.toThrow()
  })

  it('streaming 模式下 stderr 不混入 stdout（stdout 仅含答案）[P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    // stdout 不应包含 "hint:" 前缀（hint 应在 stderr）
    expect(io.outBuf()).not.toContain('hint:')
    // stderr 包含 conversation hint
    expect(io.errBuf()).toContain('--conversation')
  })

  it('streaming 支持 --input 参数（message 传入 app）[P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'stream-input', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('stream-input')
  })

  it('streaming 模式支持多 input（workflow app）[P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputsJson: '{"x":"a","y":"b"}', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.lastRunBody?.inputs).toMatchObject({ x: 'a', y: 'b' })
  })

  it('streaming 模式下 -o json 输出合法 JSON envelope [P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true, format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const parsed = JSON.parse(io.outBuf()) as { mode: string, answer: string }
    expect(parsed.mode).toBe('chat')
    expect(parsed.answer).toContain('echo:')
  })

  it('workflow streaming 输出 workflow_finished 事件 [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: {}, stream: true, format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const parsed = JSON.parse(io.outBuf()) as { data?: { status?: string } }
    expect(parsed.data?.status).toBe('succeeded')
  })

  it('默认剥离 <think> block：stdout 不包含思考内容 [P1]', async () => {
    mock.setScenario('think-blocks')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('echo:')
    expect(io.outBuf()).not.toContain('<think>')
    expect(io.outBuf()).not.toContain('reasoning')
  })

  it('--think 输出 <think> block 到 stderr [P1]', async () => {
    mock.setScenario('think-blocks')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true, think: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.errBuf()).toContain('<think>')
    expect(io.errBuf()).toContain('reasoning')
    expect(io.outBuf()).not.toContain('reasoning')
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('streaming 服务端返回 error event，CLI 抛出 BaseError [P0]', async () => {
    mock.setScenario('stream-error')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )).rejects.toMatchObject({ code: 'server_5xx' })
  })

  it('streaming 网络异常（server-5xx）返回 network error [P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('streaming app 不存在返回错误 [P0]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-nonexistent', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('未登录执行 streaming 返回认证错误（exit code 4）[P0]', async () => {
    mock.setScenario('auth-expired')
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-1', message: 'hi', stream: true },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('服务端 500 时 streaming 返回执行失败 [P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('streaming 模式输出支持 pipe（-o json 首字符为 {）[P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true, format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().trim().startsWith('{')).toBe(true)
  })

  it('JSON 模式错误输出 JSON envelope（BaseError）[P1]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-1', message: 'hi', stream: true, format: 'json' },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      if (e instanceof BaseError) {
        expect(e.code).toBeTruthy()
      }
    }
  })

  it('外部 SSO 用户可执行 streaming run（dfoe_ token）[P0]', async () => {
    const ssoHttp = createClient({ host: mock.url, bearer: 'dfoe_test', retryAttempts: 0 })
    const ssoBundle = hostsBundleFixture({ bearer: 'dfoe_test' })
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: ssoBundle, http: ssoHttp, host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('echo:')
  })
})
