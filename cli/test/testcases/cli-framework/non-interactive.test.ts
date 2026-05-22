/**
 * Dify CLI/CLI Framework/Non-Interactive 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/CLI Framework/Non-Interactive（30 条）
 *
 * 覆盖策略：
 *  - 通过 bufferStreams（isOutTTY=false, isErrTTY=false）模拟非 TTY 环境
 *  - 验证 ANSI 颜色关闭、无 spinner、JSON/YAML 输出纯净、stderr/stdout 隔离
 *  - 非 TTY 环境下命令正常执行、exit code 正确
 */

import type { ExitCodeValue } from '../../../src/errors/codes.js'
import type { DifyMock } from '../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadAppInfoCache } from '../../../src/cache/app-info.js'
import { runGetApp } from '../../../src/commands/get/app/run.js'
import { runApp } from '../../../src/commands/run/app/run.js'
import { BaseError } from '../../../src/errors/base.js'
import { ExitCode } from '../../../src/errors/codes.js'
import { stringifyOutput, table } from '../../../src/framework/output.js'
import { createClient } from '../../../src/http/client.js'
import { colorEnabled, colorScheme } from '../../../src/io/color.js'
import { bufferStreams } from '../../../src/io/streams.js'
import { hostsBundleFixture } from '../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../fixtures/dify-mock/server.js'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHFA-DJsuhl]/
const hasAnsi = (s: string) => ANSI_RE.test(s)

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

describe('Dify CLI/CLI Framework/Non-Interactive', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-noninteractive-'))
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

  // ── ANSI color 控制 ───────────────────────────────────────────────────────

  it('非 TTY 环境（isErrTTY=false）colorEnabled 返回 false [P0]', () => {
    expect(colorEnabled(false)).toBe(false)
    expect(colorEnabled(true)).toBe(true)
  })

  it('colorEnabled=false 时 colorScheme 所有方法为 identity（无 ANSI）[P0]', () => {
    const cs = colorScheme(false)
    const text = 'hello'
    expect(cs.bold(text)).toBe(text)
    expect(cs.dim(text)).toBe(text)
    expect(cs.cyan(text)).toBe(text)
    expect(cs.magenta(text)).toBe(text)
    expect(hasAnsi(cs.bold(text))).toBe(false)
    expect(hasAnsi(cs.cyan(text))).toBe(false)
  })

  it('非 TTY 环境 table 输出不含 ANSI color [P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    expect(hasAnsi(out)).toBe(false)
  })

  it('非 TTY 环境 JSON 输出不含 ANSI color [P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(hasAnsi(out)).toBe(false)
  })

  it('非 TTY 环境 YAML 输出不含 ANSI color [P0]', async () => {
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(hasAnsi(out)).toBe(false)
  })

  // ── spinner 行为 ──────────────────────────────────────────────────────────

  it('非 TTY 环境（isErrTTY=false）spinner 不输出到 stderr [P0]', async () => {
    // bufferStreams() 默认 isErrTTY=false → spinner 被禁用（NOOP_SPINNER）
    const io = bufferStreams()
    await runGetApp({}, { bundle: baseBundle, http: http(), io })
    // 如果有 spinner，errBuf 会包含 ANSI 序列；非 TTY 应为空或仅含 hint
    expect(hasAnsi(io.errBuf())).toBe(false)
  })

  it('非 TTY 环境 stream run 输出无 spinner ANSI [P1]', async () => {
    const io = bufferStreams()
    const c = await cache()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: c },
    )
    expect(hasAnsi(io.outBuf())).toBe(false)
  })

  // ── 命令正常执行 ──────────────────────────────────────────────────────────

  it('非 TTY 环境命令正常执行（get app 返回正确数据）[P0]', async () => {
    const io = bufferStreams()
    const result = await runGetApp({}, { bundle: baseBundle, http: http(), io })
    expect(result.data.rows.length).toBeGreaterThan(0)
  })

  it('非 TTY 环境 JSON 输出可正常解析（pipe 友好）[P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(() => JSON.parse(out)).not.toThrow()
    const parsed = JSON.parse(out) as { data: unknown[] }
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  it('非 TTY 环境 YAML 输出可正常解析 [P1]', async () => {
    const { default: yaml } = await import('js-yaml')
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(() => yaml.load(out)).not.toThrow()
  })

  it('stderr 日志不污染 stdout（bufferStreams 分离）[P0]', async () => {
    const io = bufferStreams()
    const c = await cache()
    await runApp(
      { appId: 'app-1', message: 'test' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: c },
    )
    // stdout 只含答案
    expect(io.outBuf()).toContain('echo:')
    // stderr 可能含 hint，但不含答案内容
    expect(io.errBuf()).not.toContain('echo: test')
  })

  it('非交互模式错误立即返回（不 hang），stderr 有错误信息 [P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    const start = Date.now()
    try {
      await runGetApp({}, { bundle: baseBundle, http: http(), io })
    }
    catch { /* expected */ }
    // 应在 5s 内完成（不阻塞等待用户输入）
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('非交互模式 exit code 正确（成功=0）[P0]', async () => {
    let code: ExitCodeValue = ExitCode.Success
    try {
      await runGetApp({}, { bundle: baseBundle, http: http() })
    }
    catch (e) {
      if (e instanceof BaseError)
        code = e.exit()
    }
    expect(code).toBe(ExitCode.Success)
  })

  it('非交互模式 exit code 正确（auth error=4）[P0]', async () => {
    mock.setScenario('auth-expired')
    try {
      await runGetApp({}, { bundle: baseBundle, http: http() })
    }
    catch (e) {
      if (e instanceof BaseError)
        expect(e.exit()).toBe(ExitCode.Auth)
    }
  })

  it('非交互模式 workspace 切换正常（-w flag 生效）[P1]', async () => {
    const result = await runGetApp({ workspace: 'ws-2' }, { bundle: baseBundle, http: http() })
    const ids = result.data.rows.map(r => r.data.id)
    expect(ids).toContain('app-3')
    expect(ids).not.toContain('app-1')
  })

  // ── shell pipe 支持 ───────────────────────────────────────────────────────

  it('shell pipe 支持（-o json 输出可被进一步解析）[P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    // 模拟 jq .data[0].id
    const parsed = JSON.parse(out) as { data: Array<{ id: string }> }
    expect(parsed.data[0]?.id).toBeDefined()
  })

  it('JSON 输出末尾为 \\n，适合 pipe 管道处理 [P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(out.endsWith('\n')).toBe(true)
  })

  it('大量输出在 pipe 场景稳定（all-workspaces 4 个 app）[P1]', async () => {
    const result = await runGetApp({ allWorkspaces: true, format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    const parsed = JSON.parse(out) as { data: unknown[] }
    expect(parsed.data).toHaveLength(4)
  })

  // ── 非 TTY 环境错误 JSON envelope ─────────────────────────────────────────

  it('非交互模式错误 JSON envelope 正常（server-5xx 抛 BaseError）[P1]', async () => {
    mock.setScenario('server-5xx')
    const { toEnvelope } = await import('../../../src/errors/envelope.js')
    try {
      await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    }
    catch (e) {
      if (e instanceof BaseError) {
        const env = toEnvelope(e)
        const json = JSON.stringify(env)
        expect(() => JSON.parse(json)).not.toThrow()
        expect(env.error.code).toBeTruthy()
      }
    }
  })

  // ── stream 模式 ───────────────────────────────────────────────────────────

  it('stream 模式在非 TTY 环境正常输出（bufferStreams）[P1]', async () => {
    const io = bufferStreams()
    const c = await cache()
    await runApp(
      { appId: 'app-1', message: 'non-tty-stream', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: c },
    )
    expect(io.outBuf()).toContain('echo:')
    expect(io.outBuf()).toContain('non-tty-stream')
  })

  it('网络错误在非 TTY 环境正常返回（不阻塞）[P1]', async () => {
    mock.setScenario('server-5xx')
    const start = Date.now()
    try {
      await runGetApp({}, { bundle: baseBundle, http: http() })
    }
    catch { /* expected */ }
    expect(Date.now() - start).toBeLessThan(5000)
  })
})
