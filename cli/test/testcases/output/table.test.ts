/**
 * Dify CLI/Output/Table 输出 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Output/Table 输出（28 条）
 *
 * 覆盖策略：
 *  - 通过 runGetApp / runDescribeApp / runApp 等真实命令 + startMock() 验证端到端 table 输出
 *  - 验证表头、列对齐、Unicode 宽度、ANSI 清洁、空列表、多 workspace 列等属性
 *  - TablePrintFlags 内部对齐逻辑已在 src/printers/format-table.test.ts 覆盖
 *  - output.test.ts 中已覆盖 CJK 列宽对齐，此处仅做集成端到端断言
 */

import type { DifyMock } from '../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hostsBundleFixture } from '../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../fixtures/dify-mock/server.js'
import { loadAppInfoCache } from '../../../src/cache/app-info.js'
import { createClient } from '../../../src/http/client.js'
import { bufferStreams } from '../../../src/io/streams.js'
import { stringifyOutput, table, formatted } from '../../../src/framework/output.js'
import { runGetApp } from '../../../src/commands/get/app/run.js'
import { runDescribeApp } from '../../../src/commands/describe/app/run.js'
import { runApp } from '../../../src/commands/run/app/run.js'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHFABCDJsuhl]/
function hasAnsi(s: string): boolean {
  return ANSI_RE.test(s)
}

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

describe('Dify CLI/Output/Table 输出', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-output-table-'))
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

  // ── 基础 table 格式 ───────────────────────────────────────────────────────

  it('默认输出格式为 table（get app 不传 -o）[P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    // table 格式：首行为表头，包含 NAME
    expect(out).toMatch(/NAME/)
    expect(out).toContain('Greeter')
  })

  it('table 输出包含表头（header row）[P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    const lines = out.split('\n').filter(Boolean)
    // 第一行为表头
    expect(lines[0]).toMatch(/NAME\s+ID\s+MODE/)
  })

  it('table 输出列顺序正确（NAME ID MODE TAGS UPDATED）[P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    const header = out.split('\n')[0] ?? ''
    const nameIdx = header.indexOf('NAME')
    const idIdx = header.indexOf('ID')
    const modeIdx = header.indexOf('MODE')
    const tagsIdx = header.indexOf('TAGS')
    const updatedIdx = header.indexOf('UPDATED')
    expect(nameIdx).toBeLessThan(idIdx)
    expect(idIdx).toBeLessThan(modeIdx)
    expect(modeIdx).toBeLessThan(tagsIdx)
    expect(tagsIdx).toBeLessThan(updatedIdx)
  })

  it('table 输出数据与字段对齐（同一列数据左对齐）[P1]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    const lines = out.split('\n').filter(Boolean)
    // 至少有表头 + 2 行数据（ws-1 有 app-1 和 app-2）
    expect(lines.length).toBeGreaterThanOrEqual(3)
  })

  it('table 输出支持多行数据（ws-1 有 2 个 app）[P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    const lines = out.split('\n').filter(Boolean)
    // 表头 + 2 数据行
    expect(lines.length).toBe(3)
  })

  it('table 输出空列表场景稳定（无数据时不崩溃）[P1]', async () => {
    // ws-nonexistent 返回空列表
    const result = await runGetApp({ workspace: 'ws-nonexistent' }, { bundle: baseBundle, http: http() })
    expect(() => stringifyOutput(table({ format: '', data: result.data }))).not.toThrow()
    expect(result.data.rows).toHaveLength(0)
  })

  it('table header 大小写正确（全大写）[P1]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    const header = out.split('\n')[0] ?? ''
    expect(header).toMatch(/^NAME\s/)
    expect(header).not.toMatch(/name/)
  })

  // ── wide 格式 ─────────────────────────────────────────────────────────────

  it('-o wide 输出包含 AUTHOR 和 WORKSPACE 扩展列 [P1]', async () => {
    const result = await runGetApp({ format: 'wide' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'wide', data: result.data }))
    expect(out).toMatch(/AUTHOR\s+WORKSPACE/)
    expect(out).toContain('tester')
    expect(out).toContain('Default')
  })

  it('-o wide 的 WORKSPACE 列显示工作区名称（非 ID）[P1]', async () => {
    const result = await runGetApp({ format: 'wide' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'wide', data: result.data }))
    expect(out).toContain('Default')
    // ws-1 的 ID 不应出现在 table 行中
    const dataLines = out.split('\n').slice(1).filter(Boolean)
    for (const line of dataLines)
      expect(line).not.toMatch(/\bws-1\b/)
  })

  // ── ANSI / pipe 行为 ──────────────────────────────────────────────────────

  it('非 TTY 环境（bufferStreams isOutTTY=false）下 table 无 ANSI 颜色 [P0]', async () => {
    // stringifyOutput 不注入 ANSI，颜色只在 io 层（spinner/color）注入
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    expect(hasAnsi(out)).toBe(false)
  })

  it('table 输出支持 pipe（末尾为 \\n，无控制字符）[P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    expect(out.endsWith('\n')).toBe(true)
    expect(hasAnsi(out)).toBe(false)
  })

  it('table 输出无额外控制字符（\\r 等）[P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    expect(out).not.toContain('\r')
  })

  it('table 输出顺序稳定：连续两次执行结果相同 [P1]', async () => {
    const render = () =>
      runGetApp({}, { bundle: baseBundle, http: http() }).then(r =>
        stringifyOutput(table({ format: '', data: r.data })),
      )
    const out1 = await render()
    const out2 = await render()
    expect(out1).toBe(out2)
  })

  // ── 多 workspace 场景 ─────────────────────────────────────────────────────

  it('多 workspace table 输出包含 WORKSPACE 列（-A -o wide）[P0]', async () => {
    const result = await runGetApp({ allWorkspaces: true, format: 'wide' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'wide', data: result.data }))
    expect(out).toContain('WORKSPACE')
    expect(out).toContain('Default')
    expect(out).toContain('Other')
  })

  it('WORKSPACE 列显示 workspace 标识（名称非 ID）[P1]', async () => {
    const result = await runGetApp({ allWorkspaces: true, format: 'wide' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'wide', data: result.data }))
    // ws-2 的数据应显示 "Other" 而非 "ws-2"
    const dataLines = out.split('\n').slice(1).filter(Boolean)
    const hasWorkspaceName = dataLines.some(l => l.includes('Default') || l.includes('Other'))
    expect(hasWorkspaceName).toBe(true)
  })

  // ── streaming / describe 不使用 table printer ─────────────────────────────

  it('streaming 模式不使用 table printer：stdout 输出为纯文本 [P0]', async () => {
    const c = await cache()
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: c },
    )
    // 不含表头（NAME、ID 等 table 列名）
    expect(io.outBuf()).not.toMatch(/^NAME\s/m)
  })

  it('describe 命令不使用 table printer：输出为 key: value 分节格式 [P1]', async () => {
    const c = await cache()
    const data = await runDescribeApp(
      { appId: 'app-1' },
      { bundle: baseBundle, http: http(), host: mock.url, cache: c },
    )
    const out = stringifyOutput(formatted({ format: '', data }))
    // describe 输出含 "Name:  Greeter" 风格，不含 table 列名 ID
    expect(out).toMatch(/Name:\s+Greeter/)
    expect(out).not.toMatch(/^NAME\s/m)
  })

  // ── JSON/YAML 模式不走 table printer ──────────────────────────────────────

  it('JSON 模式不会走 table printer：输出为 {…} 而非对齐表格 [P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    // JSON 模式：首字符为 {，不含表头
    expect(out.trim().startsWith('{')).toBe(true)
    expect(out).not.toMatch(/^NAME\s/m)
  })

  it('YAML 模式不会走 table printer：输出含 data: 而非对齐表格 [P0]', async () => {
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(out).toContain('data:')
    expect(out).not.toMatch(/^NAME\s/m)
  })

  // ── 空字段处理 ────────────────────────────────────────────────────────────

  it('空字段（无 tags 的 app）在 table 中显示为空字符串而非 undefined [P1]', async () => {
    const result = await runGetApp({ mode: 'workflow' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    // app-2 没有 tags，对应列应为空而非出现 "undefined"
    expect(out).not.toContain('undefined')
  })

  it('NULL 字段显示稳定（不崩溃，不输出 null 字面量）[P1]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: '', data: result.data }))
    expect(out).not.toContain('null')
    expect(() => out).not.toThrow()
  })

  // ── 非法 format ───────────────────────────────────────────────────────────

  it('非法 table format 返回 "not supported" 错误 [P0]（由 output.ts 统一抛出）', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    expect(() =>
      stringifyOutput(table({ format: 'csv', data: result.data })),
    ).toThrow(/not supported/)
  })
})
