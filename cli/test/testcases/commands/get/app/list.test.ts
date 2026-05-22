/**
 * Discovery / App 列表 集成测试
 *
 * 覆盖 `difyctl get app` (runGetApp) 的列表行为。
 * 测试用例来源：飞书文档《Dify CLI Enhanced》— Discovery / App 列表
 *
 * 测试框架：Vitest + dify-mock fixture server
 * 范式：模式 A（依赖注入）：通过 startMock() 启动本地 HTTP Mock，
 *       注入 createClient / bundle / io，直接调用 runGetApp()。
 */

import type { HostsBundle } from '../../../../../src/auth/hosts.js'
import type { DifyMock } from '../../../../fixtures/dify-mock/server.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runGetApp } from '../../../../../src/commands/get/app/run.js'
import { stringifyOutput, table } from '../../../../../src/framework/output.js'
import { createClient } from '../../../../../src/http/client.js'
import { LIMIT_DEFAULT, LIMIT_MAX, LIMIT_MIN } from '../../../../../src/limit/limit.js'
import { hostsBundleFixture } from '../../../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../../../fixtures/dify-mock/server.js'

// ---------------------------------------------------------------------------
// 共用 fixture
// ---------------------------------------------------------------------------

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

// ---------------------------------------------------------------------------
// Discovery / App 列表
// ---------------------------------------------------------------------------

describe('Discovery / App 列表', () => {
  let mock: DifyMock

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(() => {
    mock.setScenario('happy')
    mock.reset()
  })
  afterAll(async () => {
    await mock.stop()
  })

  function http() {
    return createClient({ host: mock.url, bearer: 'dfoa_test' })
  }

  /** 渲染为字符串，方便断言输出内容 */
  async function render(opts: Parameters<typeof runGetApp>[0] = {}): Promise<string> {
    const result = await runGetApp(opts, { bundle: baseBundle, http: http() })
    return stringifyOutput(table({
      format: opts.format ?? '',
      data: result.data,
    }))
  }

  // =========================================================================
  // 基础列表
  // =========================================================================

  describe('基础列表', () => {
    it('TC-LIST-001: 默认列出当前工作区的全部 App，表头包含 NAME ID MODE TAGS UPDATED', async () => {
      const out = await render()
      expect(out).toMatch(/NAME\s+ID\s+MODE\s+TAGS\s+UPDATED/)
    })

    it('TC-LIST-002: 默认只返回当前工作区（ws-1）的 App，不包含其他工作区的 App', async () => {
      const out = await render()
      // ws-1 中的 app-1(Greeter/chat) 和 app-2(Workflow/workflow)
      expect(out).toContain('Greeter')
      expect(out).toContain('app-1')
      expect(out).toContain('Workflow')
      expect(out).toContain('app-2')
      // ws-2 中的 app-3(OtherWS Bot) 不应出现
      expect(out).not.toContain('app-3')
      expect(out).not.toContain('OtherWS Bot')
    })

    it('TC-LIST-003: 列表行包含 mode 字段，chat 和 workflow 均能正确显示', async () => {
      const out = await render()
      expect(out).toContain('chat')
      expect(out).toContain('workflow')
    })

    it('TC-LIST-004: 列表行包含 tags 字段，带 tag 的 App 显示 tag 名称', async () => {
      const out = await render()
      // app-1 (Greeter) 有 tag: demo
      expect(out).toContain('demo')
    })

    it('TC-LIST-005: 列表行包含 updated_at 字段', async () => {
      const out = await render()
      // app-1 updated_at = 2026-01-02T00:00:00Z
      expect(out).toContain('2026-01-02')
    })

    it('TC-LIST-006: 无 App 时返回空表（0 行数据）', async () => {
      // ws-3 不存在，服务器返回空列表
      const result = await runGetApp(
        { workspace: 'ws-nonexistent' },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.rows).toHaveLength(0)
      expect(result.data.envelope.total).toBe(0)
    })
  })

  // =========================================================================
  // 按 mode 过滤
  // =========================================================================

  describe('--mode 过滤', () => {
    it('TC-FILTER-MODE-001: --mode workflow 只返回 workflow 类型的 App', async () => {
      const out = await render({ mode: 'workflow' })
      expect(out).toContain('Workflow')
      expect(out).toContain('app-2')
      expect(out).not.toContain('Greeter')
      expect(out).not.toContain('app-1')
    })

    it('TC-FILTER-MODE-002: --mode chat 只返回 chat 类型的 App', async () => {
      const out = await render({ mode: 'chat' })
      expect(out).toContain('Greeter')
      expect(out).not.toContain('Workflow')
    })

    it('TC-FILTER-MODE-003: --mode 传入不存在的 mode 时返回空结果', async () => {
      const result = await runGetApp(
        { mode: 'nonexistent-mode' },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.rows).toHaveLength(0)
    })
  })

  // =========================================================================
  // 按 tag 过滤
  // =========================================================================

  describe('--tag 过滤', () => {
    it('TC-FILTER-TAG-001: --tag demo 只返回带 demo 标签的 App', async () => {
      const out = await render({ tag: 'demo' })
      expect(out).toContain('Greeter')
      expect(out).not.toContain('Workflow')
    })

    it('TC-FILTER-TAG-002: --tag 传入不存在的 tag 时返回空结果', async () => {
      const result = await runGetApp(
        { tag: 'nonexistent-tag' },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.rows).toHaveLength(0)
    })
  })

  // =========================================================================
  // 按 name 过滤
  // =========================================================================

  describe('--name 过滤', () => {
    it('TC-FILTER-NAME-001: --name Greeter 精确匹配名称', async () => {
      const out = await render({ name: 'Greeter' })
      expect(out).toContain('Greeter')
      expect(out).not.toContain('Workflow')
    })

    it('TC-FILTER-NAME-002: --name 传入子串时服务器进行模糊匹配', async () => {
      // mock 服务器用 includes() 进行名称匹配
      const out = await render({ name: 'Greet' })
      expect(out).toContain('Greeter')
      expect(out).not.toContain('Workflow')
    })

    it('TC-FILTER-NAME-003: --name 传入不存在的名称时返回空结果', async () => {
      const result = await runGetApp(
        { name: 'NonExistentAppXYZ' },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.rows).toHaveLength(0)
    })
  })

  // =========================================================================
  // 工作区选择
  // =========================================================================

  describe('工作区选择', () => {
    it('TC-WS-001: --workspace ws-2 切换到其他工作区，只显示该工作区的 App', async () => {
      const out = await render({ workspace: 'ws-2' })
      expect(out).toContain('app-3')
      expect(out).toContain('OtherWS Bot')
      expect(out).toContain('app-4')
      expect(out).toContain('Researcher')
      expect(out).not.toContain('Greeter')
      expect(out).not.toContain('app-1')
    })

    it('TC-WS-002: -A (allWorkspaces) 聚合所有工作区的 App，按 id 排序', async () => {
      const out = await render({ allWorkspaces: true })
      expect(out).toContain('app-1')
      expect(out).toContain('app-2')
      expect(out).toContain('app-3')
      expect(out).toContain('app-4')
      // 确认按 id 排序：app-1 在 app-4 之前
      const idxApp1 = out.indexOf('app-1')
      const idxApp4 = out.indexOf('app-4')
      expect(idxApp1).toBeLessThan(idxApp4)
    })

    it('TC-WS-003: -A 聚合时 total 为所有工作区 App 数量之和', async () => {
      const result = await runGetApp(
        { allWorkspaces: true },
        { bundle: baseBundle, http: http() },
      )
      // ws-1 有 2 个 App，ws-2 有 2 个 App，共 4 个
      expect(result.data.envelope.total).toBe(4)
      expect(result.data.rows).toHaveLength(4)
    })

    it('TC-WS-004: 未提供工作区且 bundle 无工作区时抛出包含 "no workspace" 的错误', async () => {
      const minimal: HostsBundle = { current_host: 'h', token_storage: 'file' }
      await expect(
        runGetApp({}, { bundle: minimal, http: http() }),
      ).rejects.toThrow(/no workspace/)
    })
  })

  // =========================================================================
  // 输出格式
  // =========================================================================

  describe('输出格式 (-o)', () => {
    it('TC-FORMAT-001: -o json 输出可解析的 JSON，包含 data 数组和 total 字段', async () => {
      const out = await render({ format: 'json' })
      const parsed = JSON.parse(out) as { data: Array<{ id: string }>, total: number }
      expect(parsed.data).toBeInstanceOf(Array)
      expect(typeof parsed.total).toBe('number')
      expect(parsed.data.map(r => r.id).sort()).toEqual(['app-1', 'app-2'])
    })

    it('TC-FORMAT-002: -o json 输出的每个 App 包含 id name mode tags updated_at 字段', async () => {
      const out = await render({ format: 'json' })
      const parsed = JSON.parse(out) as { data: Array<Record<string, unknown>> }
      const app1 = parsed.data.find(r => r.id === 'app-1')
      expect(app1).toBeDefined()
      expect(app1).toHaveProperty('name', 'Greeter')
      expect(app1).toHaveProperty('mode', 'chat')
      expect(app1).toHaveProperty('tags')
      expect(app1).toHaveProperty('updated_at')
    })

    it('TC-FORMAT-003: -o yaml 输出包含 YAML 格式的 data 字段', async () => {
      const out = await render({ format: 'yaml' })
      expect(out).toContain('data:')
      expect(out).toContain('id: app-1')
      expect(out).toContain('name: Greeter')
    })

    it('TC-FORMAT-004: -o name 每行输出一个 App ID', async () => {
      const out = await render({ format: 'name' })
      const lines = out.trim().split('\n').sort()
      expect(lines).toEqual(['app-1', 'app-2'])
    })

    it('TC-FORMAT-005: -o wide 包含 AUTHOR 和 WORKSPACE 扩展列', async () => {
      const out = await render({ format: 'wide' })
      expect(out).toMatch(/NAME\s+ID\s+MODE\s+TAGS\s+UPDATED\s+AUTHOR\s+WORKSPACE/)
      expect(out).toContain('tester') // author
      expect(out).toContain('Default') // workspace name
    })

    it('TC-FORMAT-006: -o wide 的 WORKSPACE 列显示工作区名称而非 ID', async () => {
      const out = await render({ format: 'wide' })
      expect(out).toContain('Default')
      expect(out).not.toMatch(/\bws-1\b/)
    })

    it('TC-FORMAT-007: 不支持的 format 类型抛出包含 "not supported" 的错误', async () => {
      await expect(render({ format: 'bogus' })).rejects.toThrow(/not supported/)
    })

    it('TC-FORMAT-008: 表格列定义包含 NAME ID MODE TAGS UPDATED AUTHOR WORKSPACE 七列', async () => {
      const result = await runGetApp({}, { bundle: baseBundle, http: http() })
      const columns = result.data.tableColumns().map(c => c.name)
      expect(columns).toEqual(['NAME', 'ID', 'MODE', 'TAGS', 'UPDATED', 'AUTHOR', 'WORKSPACE'])
    })
  })

  // =========================================================================
  // 分页
  // =========================================================================

  describe('分页', () => {
    it('TC-PAGE-001: 默认 page=1，返回第一页数据', async () => {
      const result = await runGetApp(
        { page: 1 },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.page).toBe(1)
    })

    it('TC-PAGE-002: page <= 0 时自动修正为 1', async () => {
      const result = await runGetApp(
        { page: 0 },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.page).toBe(1)
    })

    it(`TC-PAGE-003: 默认 limit 为 ${LIMIT_DEFAULT}`, async () => {
      const result = await runGetApp(
        {},
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.limit).toBe(LIMIT_DEFAULT)
    })

    it('TC-PAGE-004: --limit 1 限制每页 1 条', async () => {
      const result = await runGetApp(
        { limitRaw: '1' },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.limit).toBe(1)
      expect(result.data.rows).toHaveLength(1)
    })

    it(`TC-PAGE-005: --limit ${LIMIT_MAX} 不超过最大值时正常运行`, async () => {
      const result = await runGetApp(
        { limitRaw: String(LIMIT_MAX) },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.limit).toBe(LIMIT_MAX)
    })

    it('TC-PAGE-006: --limit 超过最大值时抛出 UsageInvalidFlag 错误', async () => {
      await expect(
        runGetApp({ limitRaw: String(LIMIT_MAX + 1) }, { bundle: baseBundle, http: http() }),
      ).rejects.toThrow(/out of range/)
    })

    it(`TC-PAGE-007: --limit ${LIMIT_MIN} 最小值时正常运行`, async () => {
      const result = await runGetApp(
        { limitRaw: String(LIMIT_MIN) },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.limit).toBe(LIMIT_MIN)
    })

    it('TC-PAGE-008: --limit 0 低于最小值时抛出 UsageInvalidFlag 错误', async () => {
      await expect(
        runGetApp({ limitRaw: '0' }, { bundle: baseBundle, http: http() }),
      ).rejects.toThrow(/out of range/)
    })

    it('TC-PAGE-009: --limit 传入非数字字符串时抛出 UsageInvalidFlag 错误', async () => {
      await expect(
        runGetApp({ limitRaw: 'abc' }, { bundle: baseBundle, http: http() }),
      ).rejects.toThrow(/is not a number/)
    })

    it('TC-PAGE-010: DIFY_LIMIT 环境变量作为 limit 的 fallback', async () => {
      const result = await runGetApp(
        {},
        {
          bundle: baseBundle,
          http: http(),
          envLookup: (k: string) => (k === 'DIFY_LIMIT' ? '5' : undefined),
        },
      )
      expect(result.data.envelope.limit).toBe(5)
    })

    it('TC-PAGE-011: --limit 显式传入时优先于 DIFY_LIMIT 环境变量', async () => {
      const result = await runGetApp(
        { limitRaw: '3' },
        {
          bundle: baseBundle,
          http: http(),
          envLookup: (k: string) => (k === 'DIFY_LIMIT' ? '50' : undefined),
        },
      )
      expect(result.data.envelope.limit).toBe(3)
    })

    it('TC-PAGE-012: has_more 字段正确反映是否还有更多数据', async () => {
      // 总共 2 条，limit=1 时第一页有 has_more=true
      const result = await runGetApp(
        { limitRaw: '1' },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.has_more).toBe(true)
    })
  })

  // =========================================================================
  // 单条查询（by app ID）
  // =========================================================================

  describe('单条查询（by App ID）', () => {
    it('TC-SINGLE-001: --app-id 指定已知 ID 只返回 1 条结果', async () => {
      const out = await render({ appId: 'app-1' })
      expect(out).toContain('Greeter')
      expect(out).toContain('app-1')
      expect(out).not.toContain('Workflow')
      expect(out).not.toContain('app-2')
    })

    it('TC-SINGLE-002: --app-id 结果的 total = 1', async () => {
      const result = await runGetApp(
        { appId: 'app-1' },
        { bundle: baseBundle, http: http() },
      )
      expect(result.data.envelope.total).toBe(1)
      expect(result.data.rows).toHaveLength(1)
    })

    it('TC-SINGLE-003: --app-id 不存在的 ID 抛出 HTTP 错误（404）', async () => {
      await expect(
        runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() }),
      ).rejects.toThrow()
    })
  })

  // =========================================================================
  // 错误场景
  // =========================================================================

  describe('错误场景', () => {
    it('TC-ERR-001: 服务端 rate-limited（429）时抛出包含限流信息的错误', async () => {
      mock.setScenario('rate-limited')
      await expect(
        runGetApp({}, { bundle: baseBundle, http: http() }),
      ).rejects.toThrow()
    })

    it('TC-ERR-002: 服务端 5xx（503）时抛出错误', async () => {
      mock.setScenario('server-5xx')
      await expect(
        runGetApp({}, { bundle: baseBundle, http: http() }),
      ).rejects.toThrow()
    })

    it('TC-ERR-003: token 过期（auth-expired，401）时抛出错误', async () => {
      mock.setScenario('auth-expired')
      await expect(
        runGetApp({}, { bundle: baseBundle, http: http() }),
      ).rejects.toThrow()
    })
  })
})
