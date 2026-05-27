/**
 * E2E: difyctl auth whoami + 外部 SSO 登录行为验证
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》
 *   - Dify CLI/Auth/外部 SSO 登录（19 条，可测试部分）
 *
 * 注：交互式登录（Device Flow browser） 和 Headless 认证需要真实浏览器，
 *     E2E 层通过 injectAuth 跳过 Device Flow，专注验证 session 状态和命令行为。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'
import { optionalIt } from '../../helpers/skip.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

describe('E2E / difyctl auth whoami + SSO session', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await withTempConfig()
    configDir = tmp.configDir
    cleanup = tmp.cleanup
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[]) {
    return run(argv, { configDir })
  }

  async function withInternalAuth() {
    await mkdir(configDir, { recursive: true, mode: 0o700 })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.token}`,
      `account:`,
      `  id: acct-e2e`,
      `  email: e2e-user@example.com`,
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

  async function withSSOAuth(issuer = 'https://idp.example.com') {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoe_sso_test_token`,
      `external_subject:`,
      `  email: sso-user@example.com`,
      `  issuer: ${issuer}`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  // ── auth whoami — 内部用户 ────────────────────────────────────────────────

  it('[P0] 内部用户 auth whoami 输出 email', async () => {
    await withInternalAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/@/)
  })

  it('[P0] auth whoami --json 输出合法 JSON，包含 email', async () => {
    await withInternalAuth()
    const result = await r(['auth', 'whoami', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as { email: string }
    expect(parsed).toHaveProperty('email')
    expect(parsed.email).toMatch(/@/)
  })

  it('[P0] 未登录 auth whoami 返回认证错误（exit code 4）', async () => {
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 4)
  })

  // ── 外部 SSO 用户行为 ─────────────────────────────────────────────────────

  it('[P0] 外部 SSO 用户 auth status 显示 apps:run only 限制', async () => {
    // 文档用例：auth status 显示 apps:run only 限制
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/apps:run|SSO/i)
  })

  it('[P0] 外部 SSO 用户 auth status 不显示 workspace 信息', async () => {
    // 文档用例：auth status 不显示 workspace 信息
    await withSSOAuth()
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    // SSO 用户没有 workspace
    expect(result.stdout).not.toMatch(/^ {2}Workspace:/m)
  })

  it('[P0] 外部 SSO 用户 auth status 显示 issuer URL', async () => {
    // 文档用例：auth status 显示 External SSO Session + issuer URL
    await withSSOAuth('https://idp.enterprise.com')
    const result = await r(['auth', 'status'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('idp.enterprise.com')
  })

  it('[P0] 外部用户执行 auth use 返回错误（external SSO subjects have no workspaces）', async () => {
    // 文档用例：外部用户执行 auth use 返回错误
    await withSSOAuth()
    const result = await r(['auth', 'use', 'any-ws-id'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/external SSO|workspace/i)
  })

  it('[P0] 外部用户 get workspace 返回空列表或 insufficient_scope', async () => {
    // 文档用例：外部用户 get workspace 返回空列表
    await withSSOAuth()
    const result = await r(['get', 'workspace'])
    // SSO token 无 workspace 权限
    expect(result.exitCode).not.toBe(0)
  })

  it('[P0] 外部用户 get app 返回 insufficient_scope 错误', async () => {
    // 文档用例：外部用户 get app 返回 insufficient_scope
    await withSSOAuth()
    const result = await r(['get', 'app'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/insufficient|scope|workspace|SSO/i)
  })

  it('[P0] 外部用户 whoami 输出 SSO email', async () => {
    await withSSOAuth()
    const result = await r(['auth', 'whoami'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('sso-user@example.com')
  })

  const itWithSso = optionalIt(Boolean(E.ssoToken))

  itWithSso('[P0] 外部用户可执行 run app（使用 SSO token）', async () => {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.ssoToken}`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })

    const result = await r(['run', 'app', E.chatAppId, 'hello'])
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })
})
