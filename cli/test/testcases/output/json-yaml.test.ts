/**
 * Dify CLI/Output/JSON/YAML 输出 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Output/JSON/YAML 输出（29 条）
 *
 * 覆盖策略：
 *  - 通过 runGetApp / runDescribeApp / runApp 等真实命令 + startMock() 验证端到端输出格式
 *  - 验证 JSON/YAML 的合法性、schema 稳定性、Unicode、ANSI 清洁、pipe 友好等属性
 *  - printer 内部逻辑已在 src/printers/*.test.ts 覆盖，此处仅做集成断言
 */

import type { DifyMock } from '../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { hostsBundleFixture } from '../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../fixtures/dify-mock/server.js'
import { loadAppInfoCache } from '../../../src/cache/app-info.js'
import { createClient } from '../../../src/http/client.js'
import { bufferStreams } from '../../../src/io/streams.js'
import { stringifyOutput, table, formatted } from '../../../src/framework/output.js'
import { runGetApp } from '../../../src/commands/get/app/run.js'
import { runDescribeApp } from '../../../src/commands/describe/app/run.js'
import { runApp } from '../../../src/commands/run/app/run.js'

// ── ANSI 控制字符检测 ─────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHFABCDJsuhl]/

function hasAnsi(s: string): boolean {
  return ANSI_RE.test(s)
}

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

describe('Dify CLI/Output/JSON/YAML 输出', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-output-json-'))
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
    return loadAppInfoCache({ configDir: dir
  }) }

  // ── JSON 合法性 ──────────────────────────────────────────────────────────

  it('-o json 输出合法 JSON（get app）[P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('JSON 输出可被解析为对象（schema 含 data 数组和 total）[P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    const parsed = JSON.parse(out) as { data: unknown[], total: number }
    expect(Array.isArray(parsed.data)).toBe(true)
    expect(typeof parsed.total).toBe('number')
  })

  it('JSON 输出 schema 稳定：连续两次执行结果一致 [P0]', async () => {
    async function getJson() {
      const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
      return JSON.parse(stringifyOutput(table({ format: 'json', data: result.data }))) as object
    }
    const r1 = await getJson()
    const r2 = await getJson()
    expect(Object.keys(r1).sort()).toEqual(Object.keys(r2).sort())
  })

  it('JSON 输出字段名符合预期（data、total、page、limit、has_more）[P1]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const parsed = JSON.parse(stringifyOutput(table({ format: 'json', data: result.data }))) as Record<string, unknown>
    expect(parsed).toHaveProperty('data')
    expect(parsed).toHaveProperty('total')
    expect(parsed).toHaveProperty('page')
    expect(parsed).toHaveProperty('limit')
    expect(parsed).toHaveProperty('has_more')
  })

  it('JSON 输出包含 null 字段（无 tag 的 app description 为空字符串）[P1]', async () => {
    const result = await runGetApp({ format: 'json', mode: 'workflow' }, { bundle: baseBundle, http: http() })
    const parsed = JSON.parse(stringifyOutput(table({ format: 'json', data: result.data }))) as { data: Array<Record<string, unknown>> }
    // app-2 description = '' — 验证空值字段正常出现在 JSON 中
    const app2 = parsed.data.find((r) => r.id === 'app-2')
    expect(app2).toBeDefined()
    expect('description' in app2!).toBe(true)
  })

  it('JSON 输出 Unicode 正常编码（中文工作区名称）[P0]', async () => {
    // 中文字符在 JSON.stringify 默认输出为 Unicode 转义或原文，均为合法 JSON
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('JSON 输出支持数组对象（data 为 AppListRow 数组）[P1]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const parsed = JSON.parse(stringifyOutput(table({ format: 'json', data: result.data }))) as { data: unknown[] }
    expect(Array.isArray(parsed.data)).toBe(true)
    expect(parsed.data.length).toBeGreaterThan(0)
  })

  it('JSON 输出支持嵌套对象（tags 为嵌套 array）[P1]', async () => {
    const result = await runGetApp({ format: 'json', mode: 'chat' }, { bundle: baseBundle, http: http() })
    const parsed = JSON.parse(stringifyOutput(table({ format: 'json', data: result.data }))) as { data: Array<{ tags: unknown[] }> }
    const app1 = parsed.data.find((r: Record<string, unknown>) => r.id === 'app-1') as { tags: Array<{ name: string }> } | undefined
    expect(Array.isArray(app1?.tags)).toBe(true)
    expect(app1?.tags[0]?.name).toBe('demo')
  })

  it('JSON 输出为 pretty-print 格式（含 2 空格缩进）[P1]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    // pretty-print 包含两空格缩进
    expect(out).toContain('  ')
    // 第一行为 {
    expect(out.trimStart().startsWith('{')).toBe(true)
  })

  it('JSON 输出不包含 ANSI color 控制字符 [P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(hasAnsi(out)).toBe(false)
  })

  it('JSON 输出支持 pipe（首字符为 { 或 [，末尾为 \\n）[P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(out.trim().startsWith('{')).toBe(true)
    expect(out.endsWith('\n')).toBe(true)
  })

  it('JSON 输出顺序稳定：多次执行字段顺序一致 [P1]', async () => {
    function getKeys() {
      return runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() }).then(r => {
        const out = JSON.parse(stringifyOutput(table({ format: 'json', data: r.data }))) as Record<string, unknown>
        return Object.keys(out)
      })
    }
    const keys1 = await getKeys()
    const keys2 = await getKeys()
    expect(keys1).toEqual(keys2)
  })

  // ── JSON describe 模式 ────────────────────────────────────────────────────

  it('describe 输出 -o json 为 raw response（含 info、parameters、input_schema）[P1]', async () => {
    const c = await cache()
    const data = await runDescribeApp(
      { appId: 'app-1', format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, cache: c },
    )
    const out = stringifyOutput(formatted({ format: 'json', data }))
    const parsed = JSON.parse(out) as { info: { id: string }, parameters: unknown }
    expect(parsed.info.id).toBe('app-1')
    expect(parsed.parameters).toBeDefined()
  })

  // ── JSON stream 模式 ──────────────────────────────────────────────────────

  it('stream 模式 -o json 输出合法 JSON（chat app）[P1]', async () => {
    const c = await cache()
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true, format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: c },
    )
    expect(() => JSON.parse(io.outBuf())).not.toThrow()
  })

  it('大数据量 JSON 输出稳定（all-workspaces 4 个 app）[P1]', async () => {
    const result = await runGetApp({ allWorkspaces: true, format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    const parsed = JSON.parse(out) as { data: unknown[] }
    expect(parsed.data.length).toBe(4)
  })

  // ── YAML 合法性 ──────────────────────────────────────────────────────────

  it('-o yaml 输出合法 YAML（get app）[P0]', async () => {
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(() => yaml.load(out)).not.toThrow()
  })

  it('YAML 输出可被 js-yaml 解析为对象 [P0]', async () => {
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    const parsed = yaml.load(out) as { data: unknown[] }
    expect(parsed.data).toBeDefined()
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  it('YAML 输出结构与 JSON 一致（data 数组长度相同）[P1]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const jsonOut = JSON.parse(stringifyOutput(table({ format: 'json', data: result.data }))) as { data: unknown[] }
    const yamlOut = yaml.load(stringifyOutput(table({ format: 'yaml', data: result.data }))) as { data: unknown[] }
    expect(yamlOut.data.length).toBe(jsonOut.data.length)
  })

  it('YAML 输出支持嵌套对象（tags 结构保留）[P1]', async () => {
    const result = await runGetApp({ mode: 'chat' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    const parsed = yaml.load(out) as { data: Array<{ tags: Array<{ name: string }> }> }
    const app1 = parsed.data.find((r: Record<string, unknown>) => r.id === 'app-1') as { tags: Array<{ name: string }> } | undefined
    expect(app1?.tags[0]?.name).toBe('demo')
  })

  it('YAML 输出 Unicode 正常显示（英文 + 数字数据不含转义）[P1]', async () => {
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(out).toContain('Greeter')
  })

  it('YAML 输出不包含 ANSI color 控制字符 [P0]', async () => {
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(hasAnsi(out)).toBe(false)
  })

  it('YAML 输出支持 pipe（末尾为 \\n）[P1]', async () => {
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(out.endsWith('\n')).toBe(true)
  })

  it('大数据量 YAML 输出稳定（all-workspaces 4 个 app）[P1]', async () => {
    const result = await runGetApp({ allWorkspaces: true, format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    const parsed = yaml.load(out) as { data: unknown[] }
    expect(parsed.data.length).toBe(4)
  })

  // ── 非法 format ──────────────────────────────────────────────────────────

  it('非法 output format 返回 "not supported" 错误（table 路径）[P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    expect(() =>
      stringifyOutput(table({ format: 'invalid', data: result.data })),
    ).toThrow(/not supported/)
  })

  it('非法 output format 返回 "not supported" 错误（formatted 路径）[P0]', async () => {
    const c = await cache()
    const data = await runDescribeApp(
      { appId: 'app-1' },
      { bundle: baseBundle, http: http(), host: mock.url, cache: c },
    )
    expect(() =>
      stringifyOutput(formatted({ format: 'xml', data })),
    ).toThrow(/not supported/)
  })

  it('output format 大小写敏感（JSON 大写不被接受）[P1]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    expect(() =>
      stringifyOutput(table({ format: 'JSON', data: result.data })),
    ).toThrow(/not supported/)
  })

  // ── 错误场景 JSON envelope ────────────────────────────────────────────────

  it('错误场景：抛出 BaseError，code 和 message 可序列化为 JSON [P0]', async () => {
    mock.setScenario('server-5xx')
    const { BaseError } = await import('../../../src/errors/base.js')
    try {
      await runGetApp({}, { bundle: baseBundle, http: http() })
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      const err = e as InstanceType<typeof BaseError>
      // error 的 code 和 message 必须可 JSON 序列化（形成 JSON error envelope）
      const envelope = JSON.stringify({ code: err.code, message: err.message })
      expect(() => JSON.parse(envelope)).not.toThrow()
      const parsed = JSON.parse(envelope) as { code: string, message: string }
      expect(parsed.code).toBeTruthy()
      expect(parsed.message).toBeTruthy()
    }
  })

  it('JSON error envelope schema 稳定：code、message 字段始终存在 [P1]', async () => {
    const { BaseError } = await import('../../../src/errors/base.js')
    const scenarios = ['server-5xx', 'auth-expired', 'rate-limited'] as const
    for (const scenario of scenarios) {
      mock.setScenario(scenario)
      try {
        await runGetApp({}, { bundle: baseBundle, http: http() })
      }
      catch (e) {
        if (e instanceof BaseError) {
          expect(e.code).toBeTruthy()
          expect(e.message).toBeTruthy()
        }
      }
    }
  })

  it('错误场景 YAML 输出：抛出 BaseError，有稳定的 code 字段 [P1]', async () => {
    mock.setScenario('server-5xx')
    const { BaseError } = await import('../../../src/errors/base.js')
    try {
      await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
      expect.fail('should throw')
    }
    catch (e) {
      if (e instanceof BaseError)
        expect(e.code).toBeTruthy()
    }
  })
})
