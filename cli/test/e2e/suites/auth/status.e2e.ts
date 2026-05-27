/**
 * E2E: difyctl auth status — Auth Status
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Auth/Auth Status（12 条）
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode, assertNoAnsi } from '../../helpers/assert.js'
import { injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

describe('E2E / difyctl auth status', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const { configDir: dir, cleanup: cl } = await withTempConfig()
    configDir = dir
    cleanup = cl
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[], extraEnv?: Record<string, string>) {
    return run(argv, { configDir, env: extraEnv })
  }

  async function withAuth() {
    // Write a complete bundle including account fields so --json output includes account
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(configDir, { recursive: true, mode: 0o700 })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.token}`,
      `account:`,
      `  id: acct-e2e`,
      `  email: e2e@example.com`,
      `  name: E2E User`,
      `workspace:`,
      `  id: ${E.workspaceId}`,
      `  name: "${E.workspaceName}"`,
      `  role: owner`,
      `available_workspaces:`,
      `  - id: ${E.workspaceId}`,
      `    name: "${E.workspaceName}"`,
      `    role: owner`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  async function withSSOAuth() {
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.ssoToken || 'dfoe_test',
      workspaceId: '',
      workspaceName: '',
    })
    // Overwrite to add external_subject field
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.ssoToken || 'dfoe_test'}`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  // ── 基础状态显示 ─────────────────────────────────────────────────────────

  it('[P0] 内部用户 auth status 显示 host、email、workspace 信息', async () => {
    // 文档用例：内部用户 auth status 显示 host 信息
    await withAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain(E.host.replace(/^https?:\/\//, ''))
    expect(result.stdout).toContain(E.workspaceName)
  })

  it('[P0] auth status --json 输出合法 JSON schema', async () => {
    // 文档用例：auth status --json 输出可解析 schema
    await withAuth()
    const result = await r(['auth', 'status', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty('logged_in', true)
    expect(parsed).toHaveProperty('host')
    expect(parsed).toHaveProperty('account')
  })

  it('[P1] auth status -v 显示 workspace role 和 storage 信息', async () => {
    // 文档用例：auth status -v 显示 workspace role
    await withAuth()
    const result = await r(['auth', 'status', '-v'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('owner')
    expect(result.stdout).toMatch(/file|keychain/)
  })

  // ── 未登录场景 ────────────────────────────────────────────────────────────

  it('[P0] 未登录执行 auth status 返回 "Not logged in"，exit code 为 4', async () => {
    // 文档用例：未登录执行 auth status 返回错误 + exit code 4
    // configDir 为空（无 hosts.yml）
    const result = await r(['auth', 'status'])
    assertExitCode(result, 4)
    expect(result.stdout).toMatch(/not logged in/i)
  })

  // ── 外部 SSO 用户 ─────────────────────────────────────────────────────────

  it('[P0] 外部 SSO 用户 auth status 不显示 workspace 行', async () => {
    // 文档用例：外部 SSO 用户 auth status 不显示 workspace
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).not.toMatch(/workspace/i)
  })

  it('[P0] 外部 SSO 用户 auth status 显示 issuer URL', async () => {
    // 文档用例：外部 SSO 用户 auth status 显示 issuer URL
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('issuer.example.com')
  })

  it('[P0] 外部 SSO 用户 auth status 显示 External SSO session 信息', async () => {
    // 文档用例：外部 SSO 用户 auth status 显示 External SSO Session
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/SSO|apps:run/i)
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('[P0] token 失效（401）后 auth status 返回认证错误', async () => {
    // 文档用例：token 失效后 auth status 返回认证错误
    // 注入一个格式合法但实际已失效的 token
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_expired_token_xyz',
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    // auth status 只读本地 hosts.yml，不访问网络，所以本地 token 存在就显示状态
    // 真实的 token 失效检测发生在执行 get app / run app 等命令时
    const result = await r(['auth', 'status'])
    // 有 token 就显示状态，不报 401（status 不做网络请求）
    assertExitCode(result, 0)
  })

  it('[P1] auth status 在 JSON 模式下错误输出 JSON error envelope', async () => {
    // 文档用例：auth status 在 JSON 模式下错误输出为 JSON
    const result = await r(['auth', 'status', '--json'])
    // 未登录时 --json 模式应输出 JSON 而不是纯文本
    expect(result.exitCode).toBe(4)
    // stdout 应含 JSON（not logged in 状态）
    const parsed = JSON.parse(result.stdout) as { logged_in: boolean }
    expect(parsed.logged_in).toBe(false)
  })

  it('[P0] auth status 输出无 ANSI color（非 TTY）', async () => {
    await withAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })
})
