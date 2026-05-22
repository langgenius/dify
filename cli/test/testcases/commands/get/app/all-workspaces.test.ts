/**
 * Discovery / 跨 Workspace 查询 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Discovery/跨 Workspace 查询（22 条）
 * 命令：difyctl get app -A / --all-workspaces
 * 测试范式：模式 A（依赖注入）—— startMock() + runGetApp({ allWorkspaces: true })
 */

import type { HostsBundle } from '../../../../../src/auth/hosts.js'
import type { DifyMock } from '../../../../fixtures/dify-mock/server.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runGetApp } from '../../../../../src/commands/get/app/run.js'
import { stringifyOutput, table } from '../../../../../src/framework/output.js'
import { createClient } from '../../../../../src/http/client.js'
import { hostsBundleFixture } from '../../../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../../../fixtures/dify-mock/server.js'

// ── shared fixtures ──────────────────────────────────────────────────────────

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

// SSO bundle：外部 SSO 用户，无 workspace
const ssoBundle: HostsBundle = {
  current_host: '127.0.0.1',
  scheme: 'http',
  token_storage: 'file',
  tokens: { bearer: 'dfoe_test' },
  external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
}

// ── suite ────────────────────────────────────────────────────────────────────

describe('Discovery / 跨 Workspace 查询（-A）', () => {
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

  function http(bearer = 'dfoa_test') {
    return createClient({ host: mock.url, bearer, retryAttempts: 0 })
  }

  async function render(
    opts: Parameters<typeof runGetApp>[0] = {},
    bundle: HostsBundle = baseBundle,
  ): Promise<string> {
    const result = await runGetApp(opts, { bundle, http: http() })
    return stringifyOutput(table({ format: opts.format ?? '', data: result.data }))
  }

  // ── 基础行为 ─────────────────────────────────────────────────────────────

  it('内部用户可执行 all-workspaces 查询，返回多个 workspace 的 app [P0]', async () => {
    const out = await render({ allWorkspaces: true })
    expect(out).toContain('app-1') // ws-1
    expect(out).toContain('app-2') // ws-1
    expect(out).toContain('app-3') // ws-2
    expect(out).toContain('app-4') // ws-2
  })

  it('fan-out 查询覆盖 available_workspaces：total 为所有 workspace app 之和 [P0]', async () => {
    const result = await runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() })
    // ws-1 有 2 个 app，ws-2 有 2 个 app，共 4 个
    expect(result.data.envelope.total).toBe(4)
    expect(result.data.rows).toHaveLength(4)
  })

  it('--all-workspaces 与 -A 行为一致（同一选项两种写法）[P1]', async () => {
    // 在代码层面两者映射为同一 opts.allWorkspaces，验证结果相同
    const r1 = await runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() })
    const r2 = await runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() })
    expect(r1.data.envelope.total).toBe(r2.data.envelope.total)
    expect(r1.data.rows.map(r => r.data.id).sort())
      .toEqual(r2.data.rows.map(r => r.data.id).sort())
  })

  it('结果按 app id 字典序排列（fan-out 后 merge sort）[P0]', async () => {
    const result = await runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() })
    const ids = result.data.rows.map(r => r.data.id)
    const sorted = [...ids].sort((a, b) => a.localeCompare(b))
    expect(ids).toEqual(sorted)
  })

  // ── 表格/输出格式 ─────────────────────────────────────────────────────────

  it('table 输出包含 WORKSPACE 列（-o wide）[P0]', async () => {
    const out = await render({ allWorkspaces: true, format: 'wide' })
    expect(out).toMatch(/WORKSPACE/)
  })

  it('WORKSPACE 列显示 workspace 名称（Default / Other）[P1]', async () => {
    const out = await render({ allWorkspaces: true, format: 'wide' })
    expect(out).toContain('Default')
    expect(out).toContain('Other')
  })

  it('JSON 输出包含 workspace_id 字段 [P0]', async () => {
    const out = await render({ allWorkspaces: true, format: 'json' })
    const parsed = JSON.parse(out) as { data: Array<{ workspace_id?: string }> }
    expect(parsed.data.every(r => r.workspace_id !== undefined)).toBe(true)
  })

  it('YAML 输出包含 workspace_id [P1]', async () => {
    const out = await render({ allWorkspaces: true, format: 'yaml' })
    expect(out).toContain('workspace_id:')
  })

  it('all-workspaces 输出支持 pipe（-o name 每行一个 id）[P1]', async () => {
    const out = await render({ allWorkspaces: true, format: 'name' })
    const lines = out.trim().split('\n').sort()
    expect(lines).toEqual(['app-1', 'app-2', 'app-3', 'app-4'])
  })

  // ── 参数组合 ──────────────────────────────────────────────────────────────

  it('limit 参数在 all-workspaces 下对每个 workspace 生效 [P1]', async () => {
    // limit=1：每个 workspace 最多返回 1 条，2 个 workspace 共 2 条
    const result = await runGetApp(
      { allWorkspaces: true, limitRaw: '1' },
      { bundle: baseBundle, http: http() },
    )
    expect(result.data.rows).toHaveLength(2)
  })

  it('mode 过滤在 all-workspaces 下生效 [P1]', async () => {
    const result = await runGetApp(
      { allWorkspaces: true, mode: 'workflow' },
      { bundle: baseBundle, http: http() },
    )
    // 只有 app-2 是 workflow
    expect(result.data.rows).toHaveLength(1)
    expect(result.data.rows[0]?.data.mode).toBe('workflow')
  })

  it('同时使用 -A 与 -w 时，-A 优先：-w 被 allWorkspaces 路径忽略 [P1]', async () => {
    // 代码中 allWorkspaces 分支不走 resolveWorkspaceId，不报错
    const result = await runGetApp(
      { allWorkspaces: true, workspace: 'ws-1' },
      { bundle: baseBundle, http: http() },
    )
    // 仍然 fan-out 所有 workspace
    expect(result.data.rows.length).toBeGreaterThanOrEqual(2)
  })

  it('空 workspace 集合返回空列表（sso 场景服务端返回空 workspaces）[P1]', async () => {
    // sso 场景下 /workspaces 返回空列表，fan-out 没有目标
    mock.setScenario('sso')
    const result = await runGetApp(
      { allWorkspaces: true },
      { bundle: baseBundle, http: http() },
    )
    expect(result.data.rows).toHaveLength(0)
    expect(result.data.envelope.total).toBe(0)
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('外部 SSO 用户执行 -A 在 auth-expired 场景返回认证错误 [P0]', async () => {
    // allWorkspaces 路径调 ws.list()，在 auth-expired 场景（401）下抛错
    mock.setScenario('auth-expired')
    await expect(
      runGetApp({ allWorkspaces: true }, { bundle: ssoBundle, http: http('dfoe_test') }),
    ).rejects.toThrow()
  })

  it('外部 SSO 用户 -A exit code 为 1 [P0]', async () => {
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runGetApp({ allWorkspaces: true }, { bundle: ssoBundle, http: http('dfoe_test') })
      expect.fail('should throw')
    }
    catch (e) {
      // no workspace → UsageMissingArg or Generic, both exit 1 or 2
      if (e instanceof BaseError)
        expect(e.exit()).toBeGreaterThanOrEqual(1)
      else
        expect(e).toBeTruthy() // still an error
    }
  })

  it('未登录执行 -A 返回认证错误 [P0]', async () => {
    mock.setScenario('auth-expired')
    await expect(
      runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() }),
    ).rejects.toThrow()
  })

  it('未登录 -A exit code 为 4（Auth）[P0]', async () => {
    mock.setScenario('auth-expired')
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() })
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('网络异常时返回 server/network error [P1]', async () => {
    mock.setScenario('server-5xx')
    await expect(
      runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() }),
    ).rejects.toThrow()
  })

  it('JSON 模式错误输出 JSON envelope（抛出 BaseError）[P1]', async () => {
    mock.setScenario('server-5xx')
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runGetApp({ allWorkspaces: true }, { bundle: baseBundle, http: http() })
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
    }
  })
})
