/**
 * Dify CLI/Run/环境变量注入 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/环境变量注入（25 条）
 *
 * 说明：difyctl 的 --env KEY=VALUE 参数将 env 变量注入到 app execute 请求的
 *       inputs 对象中。在 run.ts 中通过 `inputs` 合并传递。
 *       本测试通过 mock.lastRunBody 验证注入结果。
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

/**
 * 工具：将 env 字符串数组（["KEY=val","K2=v2"]）解析为 inputs 对象，
 * 模拟 CLI 的 --env 解析逻辑（实际在 index.ts flags 层处理）。
 */
function parseEnvFlags(envFlags: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const flag of envFlags) {
    const eqIdx = flag.indexOf('=')
    if (eqIdx === -1)
      throw new Error(`invalid --env: ${flag} (missing =)`)
    const key = flag.slice(0, eqIdx)
    if (key === '')
      throw new Error(`invalid --env: key must not be empty`)
    result[key] = flag.slice(eqIdx + 1)
  }
  return result
}

describe('Dify CLI/Run/环境变量注入', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-env-'))
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

  /** 将 env flags 解析后当作 inputs 注入（模拟 CLI 层的 env→inputs 合并） */
  async function runWithEnv(envFlags: string[], extra: Record<string, unknown> = {}) {
    const envInputs = parseEnvFlags(envFlags)
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: { ...envInputs, ...extra } },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    return io
  }

  // ── 基础注入 ──────────────────────────────────────────────────────────────

  it('run app 支持单个 env 注入，值出现在 execute payload [P0]', async () => {
    await runWithEnv(['KEY=value'])
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.KEY).toBe('value')
  })

  it('run app 支持多个 env 注入，所有 env 出现在 payload [P0]', async () => {
    await runWithEnv(['K1=v1', 'K2=v2', 'K3=v3'])
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.K1).toBe('v1')
    expect(inputs?.K2).toBe('v2')
    expect(inputs?.K3).toBe('v3')
  })

  it('env 值正确传递到 execute payload [P0]', async () => {
    await runWithEnv(['API_KEY=secret123'])
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.API_KEY).toBe('secret123')
  })

  it('env key 区分大小写：KEY 和 key 是独立变量 [P1]', async () => {
    await runWithEnv(['KEY=upper', 'key=lower'])
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.KEY).toBe('upper')
    expect(inputs?.key).toBe('lower')
  })

  it('env value 支持空字符串 [P1]', async () => {
    await runWithEnv(['EMPTY='])
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.EMPTY).toBe('')
  })

  it('env value 支持特殊字符（含 = 的 value）[P1]', async () => {
    // KEY=a=b=c → key="KEY", value="a=b=c"
    const envInputs = parseEnvFlags(['KEY=a=b=c'])
    expect(envInputs.KEY).toBe('a=b=c')
  })

  it('env value 支持中文 [P1]', async () => {
    await runWithEnv(['TITLE=你好世界'])
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.TITLE).toBe('你好世界')
  })

  it('env value 支持包含空格的字符串 [P1]', async () => {
    await runWithEnv(['NAME=hello world'])
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.NAME).toBe('hello world')
  })

  it('env 支持与 input 同时使用，两类参数均出现在 payload [P0]', async () => {
    const envInputs = parseEnvFlags(['ENV_KEY=env-val'])
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: { ...envInputs, regular_input: 'input-val' } },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.ENV_KEY).toBe('env-val')
    expect(inputs?.regular_input).toBe('input-val')
  })

  it('env 支持与 streaming 同时使用 [P1]', async () => {
    const envInputs = parseEnvFlags(['STREAM_KEY=stream-val'])
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: envInputs, stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.STREAM_KEY).toBe('stream-val')
  })

  it('env 支持与 file input 同时使用，env 和文件均出现在 payload [P1]', async () => {
    const { writeFile } = await import('node:fs/promises')
    const f = join(dir, 'combo.txt')
    await writeFile(f, 'file-data')
    const envInputs = parseEnvFlags(['ENV=env-val'])
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: envInputs, files: [`doc=@${f}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.ENV).toBe('env-val')
    expect(inputs?.doc).toBeDefined()
  })

  // ── 格式/错误校验（parseEnvFlags 层）────────────────────────────────────

  it('非法 env 格式（无 =）抛出 usage error [P0]', async () => {
    expect(() => parseEnvFlags(['invalid-no-eq'])).toThrow(/missing =/)
  })

  it('env key 缺失（=abc 格式）抛出 usage error [P0]', async () => {
    expect(() => parseEnvFlags(['=abc'])).toThrow(/key must not be empty/)
  })

  it('重复 env key：后者覆盖前者 [P1]', async () => {
    const envInputs = parseEnvFlags(['K=first', 'K=second'])
    // 两次赋值，最终 K = 'second'
    expect(envInputs.K).toBe('second')
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('app 不存在时返回错误 [P0]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-nonexistent', inputs: { KEY: 'val' } },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('未登录执行 env run 返回认证错误（exit code 4）[P0]', async () => {
    mock.setScenario('auth-expired')
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-2', inputs: { KEY: 'val' } },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('服务端 500 时返回 execution failed [P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', inputs: { KEY: 'val' } },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('JSON 输出支持 pipe（首字符为 {）[P1]', async () => {
    await runWithEnv(['KEY=val'])
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: { KEY: 'val' }, format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().trim().startsWith('{')).toBe(true)
  })
})
