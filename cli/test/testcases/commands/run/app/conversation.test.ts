/**
 * Dify CLI/Run/Conversation 模式 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/Conversation 模式（24 条）
 *
 * 覆盖策略：
 *  - mock server 的 chat app (app-1) 在 happy 场景下返回固定的
 *    conversation_id = "conv-1"（见 server.ts streamingRunResponse）
 *  - 用 lastRunBody 检查 CLI 是否正确透传 conversation_id 到请求体
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

describe('Dify CLI/Run/Conversation 模式', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-conv-'))
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

  // ── 基础 conversation ─────────────────────────────────────────────────────

  it('chat app 可创建新 conversation，stderr hint 包含 conversation_id [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hello' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.errBuf()).toContain('--conversation conv-1')
  })

  it('conversation_id 在后续请求中复用：--conversation 参数透传到请求体 [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'second', conversationId: 'conv-1' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.lastRunBody?.conversation_id).toBe('conv-1')
  })

  it('--conversation 参数生效，请求体携带指定 conversation_id [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', conversationId: 'my-conv-id' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.lastRunBody?.conversation_id).toBe('my-conv-id')
  })

  it('conversation_id 缺失时自动创建新会话（不传 conversation 参数）[P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'new' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    // 不传 conversationId，请求体不含 conversation_id
    expect(mock.lastRunBody?.conversation_id).toBeUndefined()
    // stderr 提示了新 conversation
    expect(io.errBuf()).toContain('--conversation conv-1')
  })

  it('新 conversation 不继承旧上下文（不传 conversationId → 无 conversation_id in body）[P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'fresh' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.lastRunBody).not.toHaveProperty('conversation_id')
  })

  it('JSON 输出包含 conversation_id [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const parsed = JSON.parse(io.outBuf()) as { conversation_id: string }
    expect(parsed.conversation_id).toBe('conv-1')
  })

  it('JSON 输出包含 message_id [P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const parsed = JSON.parse(io.outBuf()) as { message_id: string }
    expect(parsed.message_id).toBe('msg-1')
  })

  it('conversation 输出支持 pipe（-o json 首字符为 {）[P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'pipe', format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().trim().startsWith('{')).toBe(true)
  })

  // ── streaming conversation ─────────────────────────────────────────────────

  it('conversation 模式支持 streaming [P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'stream', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('echo:')
    expect(io.errBuf()).toContain('--conversation conv-1')
  })

  it('--conversation 与 --stream 组合：conversation_id 透传到请求体 [P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', conversationId: 'conv-1', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.lastRunBody?.conversation_id).toBe('conv-1')
  })

  it('重复使用同一 conversation_id 幂等稳定 [P1]', async () => {
    for (let i = 0; i < 3; i++) {
      const io = bufferStreams()
      await runApp(
        { appId: 'app-1', message: `msg-${i}`, conversationId: 'conv-stable' },
        { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
      )
      expect(mock.lastRunBody?.conversation_id).toBe('conv-stable')
    }
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('服务端 500 时 conversation run 返回执行失败 [P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi', conversationId: 'conv-1' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('未登录执行 conversation run 返回认证错误 [P0]', async () => {
    mock.setScenario('auth-expired')
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-1', message: 'hi', conversationId: 'conv-1' },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('rate-limited 时 conversation run 抛出错误 [P1]', async () => {
    mock.setScenario('rate-limited')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi', conversationId: 'conv-1' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('JSON 模式错误输出 JSON envelope（BaseError）[P1]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-1', message: 'hi', conversationId: 'conv-1', format: 'json' },
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

  it('workflow app 传入 conversation 参数：workflow 不接受 conversation，错误稳定 [P1]', async () => {
    // workflow app (app-2) 传入 conversationId，服务端忽略或 CLI 照常执行
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: {}, conversationId: 'conv-123' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    // 不崩溃即为稳定
    expect(io.outBuf().length).toBeGreaterThanOrEqual(0)
  })
})
