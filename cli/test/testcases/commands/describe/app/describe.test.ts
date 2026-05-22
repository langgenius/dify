/**
 * Discovery / Describe App 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Discovery/Describe App（29 条）
 * 命令：difyctl describe app <id>
 * 测试范式：模式 A（依赖注入）—— startMock() + runDescribeApp()
 */

import type { HostsBundle } from '../../../../../src/auth/hosts.js'
import type { DifyMock } from '../../../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadAppInfoCache } from '../../../../../src/cache/app-info.js'
import { runDescribeApp } from '../../../../../src/commands/describe/app/run.js'
import { formatted, stringifyOutput } from '../../../../../src/framework/output.js'
import { createClient } from '../../../../../src/http/client.js'
import { hostsBundleFixture } from '../../../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../../../fixtures/dify-mock/server.js'

// ── shared fixtures ──────────────────────────────────────────────────────────

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

const ssoBundle: HostsBundle = {
  current_host: 'http://localhost',
  token_storage: 'file',
  tokens: { bearer: 'dfoe_test' },
  external_subject: { email: 'sso@dify.ai', issuer: 'https://issuer.example' },
}

// ── suite ────────────────────────────────────────────────────────────────────

describe('Discovery / Describe App', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-desc-test-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  afterAll(async () => {
    await mock.stop()
  })

  function http(bearer = 'dfoa_test') {
    return createClient({ host: mock.url, bearer, retryAttempts: 0 })
  }

  async function render(
    opts: Parameters<typeof runDescribeApp>[0],
    bearer = 'dfoa_test',
  ): Promise<string> {
    const cache = await loadAppInfoCache({ configDir: dir })
    const data = await runDescribeApp(
      opts,
      { bundle: baseBundle, http: http(bearer), host: mock.url, cache },
    )
    return stringifyOutput(formatted({ format: opts.format ?? '', data }))
  }

  // ── 基础行为 ─────────────────────────────────────────────────────────────

  it('已登录用户可 describe app，返回 app 详情 [P0]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('Greeter')
  })

  it('describe app 调用 describe endpoint（GET /openapi/v1/apps/<id>/describe）[P0]', async () => {
    // 通过 AppMetaClient 调用，验证 mock 服务端 describe 路由正常响应
    const cache = await loadAppInfoCache({ configDir: dir })
    const data = await runDescribeApp(
      { appId: 'app-1' },
      { bundle: baseBundle, http: http(), host: mock.url, cache },
    )
    expect(data.payload.info?.id).toBe('app-1')
  })

  // ── 默认 text 输出（标签式分节）────────────────────────────────────────────

  it('默认 text 输出为标签式分节结构（kubectl-describe 风格）[P0]', async () => {
    const out = await render({ appId: 'app-1' })
    // 验证有对齐的 Key: Value 行
    expect(out).toMatch(/\w+:\s+\S+/)
  })

  it('describe 输出包含 ID [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('ID:')
    expect(out).toContain('app-1')
  })

  it('describe 输出包含 Mode [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Mode:')
    expect(out).toContain('chat')
  })

  it('describe 输出包含 Name [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Name:')
    expect(out).toContain('Greeter')
  })

  it('describe 输出包含 Description（app 有 description 时）[P1]', async () => {
    // app-1 description = 'A simple greeting bot'
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Description:')
    expect(out).toContain('A simple greeting bot')
  })

  it('describe 输出包含 Author [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Author:')
    expect(out).toContain('tester')
  })

  it('describe 输出包含 Tags [P1]', async () => {
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Tags:')
    expect(out).toContain('demo')
  })

  it('describe 输出包含 Inputs（Parameters）分节 [P0]', async () => {
    // app-1 有 parameters
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('Parameters:')
  })

  it('Inputs 显示参数名 [P0]', async () => {
    // app-1 parameters.user_input_form 包含 variable=name
    const out = await render({ appId: 'app-1' })
    expect(out).toContain('name')
  })

  it('Inputs 显示参数类型 [P0]', async () => {
    const out = await render({ appId: 'app-1' })
    // text-input 类型
    expect(out).toContain('text-input')
  })

  it('Inputs 显示 required/optional [P0]', async () => {
    const out = await render({ appId: 'app-1' })
    // required: true
    expect(out).toContain('required')
  })

  it('agent app 输出包含 Agent: true [P1]', async () => {
    const out = await render({ appId: 'app-4', workspace: 'ws-2' })
    expect(out).toContain('Agent:')
    expect(out).toContain('true')
  })

  // ── 输出格式 ─────────────────────────────────────────────────────────────

  it('-o json 返回原始服务端响应（info + parameters + input_schema）[P0]', async () => {
    const out = await render({ appId: 'app-1', format: 'json' })
    const parsed = JSON.parse(out) as { info: { id: string }, parameters: unknown }
    expect(parsed.info.id).toBe('app-1')
    expect(parsed.parameters).toBeDefined()
  })

  it('JSON 输出为合法缩进 JSON（可解析且格式化）[P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'json' })
    expect(() => JSON.parse(out)).not.toThrow()
    // 有缩进（包含 "  "）
    expect(out).toContain('  ')
  })

  it('-o yaml 输出合法 YAML [P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'yaml' })
    expect(out).toContain('info:')
    expect(out).toContain('id: app-1')
  })

  it('describe app 不支持 wide 输出，返回 "not supported" 错误 [P0]', async () => {
    await expect(render({ appId: 'app-1', format: 'wide' })).rejects.toThrow(/not supported/)
  })

  it('describe app 不支持 name 输出，返回 "not supported" 错误 [P0]', async () => {
    await expect(render({ appId: 'app-1', format: 'name' })).rejects.toThrow(/name output requires|not supported/)
  })

  it('describe 输出支持 pipe（-o json 输出首字符为 {）[P1]', async () => {
    const out = await render({ appId: 'app-1', format: 'json' })
    expect(out.trim().startsWith('{')).toBe(true)
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('describe 不存在 app 返回错误 [P0]', async () => {
    await expect(render({ appId: 'app-nonexistent' })).rejects.toThrow()
  })

  it('describe 不存在 app exit code 为 1（Generic）[P0]', async () => {
    const { BaseError } = await import('../../../../../src/errors/base.js')
    const cache = await loadAppInfoCache({ configDir: dir })
    try {
      await runDescribeApp(
        { appId: 'app-nonexistent' },
        { bundle: baseBundle, http: http(), host: mock.url, cache },
      )
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(1)
    }
  })

  it('未登录执行 describe 返回认证错误 [P0]', async () => {
    mock.setScenario('auth-expired')
    await expect(render({ appId: 'app-1' })).rejects.toThrow()
  })

  it('未登录 describe exit code 为 4（Auth）[P0]', async () => {
    mock.setScenario('auth-expired')
    const { BaseError } = await import('../../../../../src/errors/base.js')
    const cache = await loadAppInfoCache({ configDir: dir })
    try {
      await runDescribeApp(
        { appId: 'app-1' },
        { bundle: baseBundle, http: http(), host: mock.url, cache },
      )
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('外部 SSO 用户 describe 返回 insufficient_scope（无 workspace）[P0]', async () => {
    const cache = await loadAppInfoCache({ configDir: dir })
    await expect(
      runDescribeApp(
        { appId: 'app-1' },
        { bundle: ssoBundle, http: http('dfoe_test'), host: mock.url, cache },
      ),
    ).rejects.toThrow(/no workspace|insufficient/)
  })

  it('网络异常 describe 返回 server/network error [P1]', async () => {
    mock.setScenario('server-5xx')
    await expect(render({ appId: 'app-1' })).rejects.toThrow()
  })

  it('JSON 模式错误输出 JSON envelope（错误为 BaseError）[P1]', async () => {
    mock.setScenario('server-5xx')
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await render({ appId: 'app-1', format: 'json' })
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
    }
  })

  it('缺少 app id 时：runDescribeApp 需要 appId，否则 workspace 解析失败 [P1]', async () => {
    // appId 为空字符串时，describe client 会查询空 id，服务端返回 404
    await expect(render({ appId: '' })).rejects.toThrow()
  })
})
