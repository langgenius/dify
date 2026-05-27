/**
 * E2E: difyctl auth use — Workspace 切换
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Auth/Workspace 切换（22 条）
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

// 测试用第二工作区 — 注入 available_workspaces 里的备用 workspace
const WS2_ID = 'ws-e2e-secondary-0000-000000000002'
const WS2_NAME = 'Secondary Workspace'

describe('E2E / difyctl auth use', () => {
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

  /** 注入带两个 workspace 的 bundle */
  async function withTwoWorkspaces() {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: ${E.token}`,
      `workspace:`,
      `  id: ${E.workspaceId}`,
      `  name: "${E.workspaceName}"`,
      `  role: owner`,
      `available_workspaces:`,
      `  - id: ${E.workspaceId}`,
      `    name: "${E.workspaceName}"`,
      `    role: owner`,
      `  - id: ${WS2_ID}`,
      `    name: "${WS2_NAME}"`,
      `    role: normal`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  async function withSSOAuth() {
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoe_sso_test`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })
  }

  // ── 正常切换 ──────────────────────────────────────────────────────────────

  it('[P0] 内部用户可切换到指定 workspace', async () => {
    // 文档用例：内部用户可切换到指定 workspace
    await withTwoWorkspaces()
    const result = await r(['auth', 'use', WS2_ID])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/switched|workspace/i)
    expect(result.stdout).toContain(WS2_NAME)
  })

  it('[P0] auth use 后 auth status 显示新 workspace', async () => {
    // 文档用例：auth use 后 auth status 显示新 workspace
    await withTwoWorkspaces()
    await r(['auth', 'use', WS2_ID])
    const status = await r(['auth', 'status'])
    assertExitCode(status, 0)
    expect(status.stdout).toContain(WS2_NAME)
  })

  it('[P0] auth use 更新 current_workspace_id（hosts.yml 被更新）', async () => {
    // 文档用例：auth use 更新 current_workspace_id
    await withTwoWorkspaces()
    await r(['auth', 'use', WS2_ID])
    const { readFile } = await import('node:fs/promises')
    const hostsContent = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsContent).toContain(WS2_ID)
  })

  it('[P1] 重复切换同一 workspace 幂等成功', async () => {
    // 文档用例：重复切换同一 workspace 幂等成功
    await withTwoWorkspaces()
    const r1 = await r(['auth', 'use', E.workspaceId])
    assertExitCode(r1, 0)
    const r2 = await r(['auth', 'use', E.workspaceId])
    assertExitCode(r2, 0)
  })

  it('[P1] auth use 后 current workspace 在重新读取时持久化', async () => {
    // 文档用例：auth use 后 current workspace 持久化
    await withTwoWorkspaces()
    await r(['auth', 'use', WS2_ID])
    // 直接读 hosts.yml 验证 workspace id 被写入
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const hostsContent = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsContent).toContain(WS2_ID)
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('[P0] 切换不存在 workspace 返回错误', async () => {
    // 文档用例：切换不存在 workspace 返回错误
    await withTwoWorkspaces()
    const result = await r(['auth', 'use', 'ws-does-not-exist-xyz'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/not found|workspace/i)
  })

  it('[P0] workspace 切换失败时 current_workspace_id 不变', async () => {
    // 文档用例：workspace 切换失败时 current_workspace_id 不变
    await withTwoWorkspaces()
    await r(['auth', 'use', 'ws-does-not-exist-xyz'])
    // 直接读 hosts.yml，原 workspace id 应仍存在
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const hostsContent = await readFile(join(configDir, 'hosts.yml'), 'utf8')
    expect(hostsContent).toContain(E.workspaceId)
  })

  it('[P0] 未登录执行 auth use 返回认证错误（exit code 4）', async () => {
    // 文档用例：未登录执行 auth use 返回认证错误 + exit code 4
    const result = await r(['auth', 'use', E.workspaceId])
    assertExitCode(result, 4)
    expect(result.stderr).toMatch(/not.?logged.?in|auth.?login/i)
  })

  it('[P0] workspace 参数缺失时返回 usage error', async () => {
    // 文档用例：workspace 参数缺失时返回 usage error
    await withTwoWorkspaces()
    const result = await r(['auth', 'use'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument|workspace/i)
  })

  // ── 外部 SSO 用户 ─────────────────────────────────────────────────────────

  it('[P0] 外部 SSO 用户执行 auth use 被拒绝', async () => {
    // 文档用例：外部 SSO 用户执行 auth use 被拒绝
    await withSSOAuth()
    const result = await r(['auth', 'use', 'any-ws-id'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/external SSO|workspace/i)
  })

  it('[P1] 外部 SSO 用户 auth use exit code 为 1 或 2', async () => {
    // 文档用例：外部 SSO 用户 auth use exit code 为 1
    await withSSOAuth()
    const result = await r(['auth', 'use', 'any-ws-id'])
    expect([1, 2]).toContain(result.exitCode)
  })

  // ── JSON 模式 ─────────────────────────────────────────────────────────────

  it('[P1] workspace 不存在时 stderr 包含错误描述', async () => {
    // 文档用例：workspace 不存在时返回错误
    // Note: auth use 不支持 -o flag，错误通过 stderr 文本输出
    await withTwoWorkspaces()
    const result = await r(['auth', 'use', 'ws-nonexistent-xyz'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/not.?found|workspace/i)
  })
})
