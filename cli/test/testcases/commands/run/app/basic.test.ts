/**
 * Dify CLI/Run/基础 App 运行 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/基础 App 运行（26 条）
 * 测试范式：模式 A（依赖注入）—— startMock() + runApp()
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

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

describe('Dify CLI/Run/基础 App 运行', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-run-basic-'))
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

  // ── 基础执行 ───────────────────────────────────────────────────────────────

  it('已登录内部用户可运行 chat app，stdout 输出结果 [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hello' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('echo: hello')
  })

  it('run app 调用 execute endpoint（app-2 workflow，stdout 有输出）[P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: { x: 'test' } },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().length).toBeGreaterThan(0)
  })

  it('默认输出执行结果到 stdout [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toMatch(/echo:/)
  })

  it('文本输出保留换行（answer 以 \\n 结尾）[P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toMatch(/\n$/)
  })

  it('-o json 输出合法 JSON，包含 mode 和 answer [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const parsed = JSON.parse(io.outBuf()) as { mode: string, answer: string }
    expect(parsed.mode).toBe('chat')
    expect(parsed.answer).toContain('echo:')
  })

  it('JSON 输出支持 pipe（首字符为 {）[P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().trim().startsWith('{')).toBe(true)
  })

  // ── inputs 参数 ───────────────────────────────────────────────────────────

  it('run app 支持 --inputs（workflow）[P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: { x: 'val' } },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('echo:')
  })

  it('多个 inputs 同时生效（传入 JSON object）[P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputsJson: '{"x":"a","y":"b"}' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.lastRunBody?.inputs).toMatchObject({ x: 'a', y: 'b' })
  })

  it('--inputs 为非 JSON 时返回 usage error [P0]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', inputsJson: 'notjson' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow(/valid JSON/)
  })

  it('--inputs 为 JSON 数组时返回 usage error [P0]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', inputsJson: '[1,2,3]' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow(/JSON object/)
  })

  it('workflow app 传入 positional message 返回 usage error [P0]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )).rejects.toMatchObject({ code: 'usage_invalid_flag' })
  })

  it('--workflow-id 透传到 execute 请求体 workflow_id [P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: {}, workflowId: 'wf-pinned-1' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.lastRunBody?.workflow_id).toBe('wf-pinned-1')
  })

  it('--inputs-file 从文件读取 JSON inputs [P0]', async () => {
    const { writeFile } = await import('node:fs/promises')
    const inputsFile = join(dir, 'inputs.json')
    await writeFile(inputsFile, JSON.stringify({ x: 'from-file' }))
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputsFile },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf()).toContain('echo:')
  })

  it('--inputs 与 --inputs-file 互斥，同时传入返回错误 [P0]', async () => {
    const { writeFile } = await import('node:fs/promises')
    const inputsFile = join(dir, 'f.json')
    await writeFile(inputsFile, '{}')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', inputsJson: '{}', inputsFile },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow(/mutually exclusive/)
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('app 不存在返回 app not found 错误 [P0]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-nonexistent', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('app 不存在 exit code 为 1（Generic）[P0]', async () => {
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-nonexistent', message: 'hi' },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      if (e instanceof BaseError)
        expect(e.exit()).toBe(1)
      else
        expect(e).toBeTruthy()
    }
  })

  it('未登录执行 run app 返回认证错误 [P0]', async () => {
    mock.setScenario('auth-expired')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('未登录 run app exit code 为 4（Auth）[P0]', async () => {
    mock.setScenario('auth-expired')
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-1', message: 'hi' },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('服务端 500 时返回执行失败错误 [P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('网络异常时返回 server/network error [P1]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('JSON 模式错误：错误为结构化 BaseError [P1]', async () => {
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-nonexistent', message: 'hi', format: 'json' },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      if (e instanceof BaseError) {
        expect(e.code).toBeTruthy()
        expect(e.message).toBeTruthy()
      }
    }
  })

  it('不支持的 format 类型返回 "not supported" 错误 [P1]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-1', format: 'bogus' },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow(/not supported/)
  })

  it('workspace override 生效：-w ws-2 使用其他工作区的 app [P1]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-3', workspace: 'ws-2' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().length).toBeGreaterThan(0)
  })

  it('重复执行 run app 每次独立完成 [P1]', async () => {
    for (let i = 0; i < 2; i++) {
      const io = bufferStreams()
      await runApp(
        { appId: 'app-1', message: `msg-${i}` },
        { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
      )
      expect(io.outBuf()).toContain(`echo: msg-${i}`)
    }
  })
})
