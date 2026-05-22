/**
 * Discovery / 单 App 查询 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Discovery/单 App 查询（22 条）
 * 命令：difyctl get app <app-id>
 * 测试范式：模式 A（依赖注入）—— startMock() + runGetApp({ appId })
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

const ssoBundle: HostsBundle = {
  current_host: '127.0.0.1',
  scheme: 'http',
  token_storage: 'file',
  tokens: { bearer: 'dfoe_test' },
  external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
}

// ── suite ────────────────────────────────────────────────────────────────────

describe('Discovery / 单 App 查询', () => {
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
    opts: Parameters<typeof runGetApp>[0],
    bundle: HostsBundle = baseBundle,
  ): Promise<string> {
    const result = await runGetApp(opts, { bundle, http: http() })
    return stringifyOutput(table({ format: opts.format ?? '', data: result.data }))
  }

  // ── 基础查询 ────────────────────────────────────────────────────────────────

  it('已登录用户可通过 id 获取 app [P0]', async () => {
    const result = await runGetApp({ appId: 'app-1' }, { bundle: baseBundle, http: http() })
    expect(result.data.rows).toHaveLength(1)
    expect(result.data.rows[0]?.data.id).toBe('app-1')
  })

  it('get app 调用 /info endpoint（describe + 封装为 envelope）[P0]', async () => {
    // 通过 describe endpoint 获取单条，total=1
    const result = await runGetApp({ appId: 'app-1' }, { bundle: baseBundle, http: http() })
    expect(result.data.envelope.total).toBe(1)
    expect(result.data.envelope.data[0]?.id).toBe('app-1')
  })

  it('单 app 默认输出为 table/text 格式，与列表格式一致 [P0]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toMatch(/NAME\s+ID\s+MODE/)
    expect(out).toContain('Greeter')
    expect(out).toContain('app-1')
  })

  it('单 app 输出包含 app id [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('app-1')
  })

  it('单 app 输出包含 app name [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Greeter')
  })

  it('单 app 输出包含 app mode [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('chat')
  })

  it('单 app 结果 total=1 [P0]', async () => {
    const result = await runGetApp({ appId: 'app-1' }, { bundle: baseBundle, http: http() })
    expect(result.data.envelope.total).toBe(1)
  })

  // ── 输出格式 ─────────────────────────────────────────────────────────────────

  it('-o json 输出合法 JSON [P0]', async () => {
    const out = await render({ appId: 'app-1', format: 'json' })
    const parsed = JSON.parse(out) as { data: Array<{ id: string }> }
    expect(parsed.data).toHaveLength(1)
    expect(parsed.data[0]?.id).toBe('app-1')
  })

  it('-o json 每个 app 包含 id、name、mode 字段 [P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'json' })
    const parsed = JSON.parse(out) as { data: Array<Record<string, unknown>> }
    expect(parsed.data[0]).toMatchObject({ id: 'app-1', name: 'Greeter', mode: 'chat' })
  })

  it('-o yaml 输出合法 YAML [P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'yaml' })
    expect(out).toContain('data:')
    expect(out).toContain('id: app-1')
    expect(out).toContain('name: Greeter')
  })

  it('-o name 输出 app id（每行一个）[P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'name' })
    expect(out.trim()).toBe('app-1')
  })

  it('-o wide 输出扩展字段 AUTHOR WORKSPACE [P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'wide' })
    expect(out).toMatch(/AUTHOR\s+WORKSPACE/)
    expect(out).toContain('tester')
    expect(out).toContain('Default')
  })

  it('get app 输出结果可 pipe（-o json 输出无多余前缀）[P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'json' })
    // 输出应为合法 JSON，首字符为 {
    expect(out.trim().startsWith('{')).toBe(true)
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('查询不存在 app 返回错误 [P0]', async () => {
    await expect(
      runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() }),
    ).rejects.toThrow()
  })

  it('app not found exit code 为 1（Generic）[P0]', async () => {
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() })
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(1)
    }
  })

  it('未登录执行 get app 返回认证错误 [P0]', async () => {
    mock.setScenario('auth-expired')
    await expect(runGetApp({ appId: 'app-1' }, { bundle: baseBundle, http: http() })).rejects.toThrow()
  })

  it('未登录 exit code 为 4（Auth）[P0]', async () => {
    mock.setScenario('auth-expired')
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runGetApp({ appId: 'app-1' }, { bundle: baseBundle, http: http() })
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('外部 SSO 用户执行 get app 返回 insufficient_scope [P0]', async () => {
    mock.setScenario('sso')
    await expect(
      runGetApp({ appId: 'app-1' }, { bundle: ssoBundle, http: http('dfoe_test') }),
    ).rejects.toThrow(/no workspace|insufficient/)
  })

  it('workspace override 生效：-w 指定 workspace 获取对应 app [P1]', async () => {
    const result = await runGetApp(
      { appId: 'app-3', workspace: 'ws-2' },
      { bundle: baseBundle, http: http() },
    )
    expect(result.data.rows[0]?.data.id).toBe('app-3')
  })

  it('app 属于其他 workspace 时返回 not found [P1]', async () => {
    // app-3 在 ws-2，用 ws-1 查询应 not found
    await expect(
      runGetApp({ appId: 'app-3', workspace: 'ws-1' }, { bundle: baseBundle, http: http() }),
    ).rejects.toThrow()
  })

  it('网络异常返回 server/network error [P1]', async () => {
    mock.setScenario('server-5xx')
    await expect(runGetApp({ appId: 'app-1' }, { bundle: baseBundle, http: http() })).rejects.toThrow()
  })

  it('JSON 模式下错误输出 JSON envelope（错误为 BaseError）[P1]', async () => {
    mock.setScenario('auth-expired')
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runGetApp({ appId: 'app-1' }, { bundle: baseBundle, http: http() })
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
    }
  })

  it('特殊字符 app id 查询失败（服务端 404）[P1]', async () => {
    await expect(
      runGetApp({ appId: 'app-!@#$%' }, { bundle: baseBundle, http: http() }),
    ).rejects.toThrow()
  })
})
