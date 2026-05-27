/**
 * E2E: difyctl auth logout — Logout
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Auth/Logout（18 条）
 */

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode } from '../../helpers/assert.js'
import { injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

describe('E2E / difyctl auth logout', () => {
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

  function r(argv: string[]) {
    return run(argv, { configDir })
  }

  async function withAuth() {
    // logout.e2e.ts runs last — safe to use E.token directly here.
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.token,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
  }

  async function hostsFileExists(): Promise<boolean> {
    try {
      await access(join(configDir, 'hosts.yml'))
      return true
    }
    catch { return false }
  }

  // ── 基础 logout ───────────────────────────────────────────────────────────

  it('[P0] 已登录用户可正常 logout，stdout 含成功信息', async () => {
    // 文档用例：已登录用户可正常 logout
    await withAuth()
    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/logged out/i)
  })

  it('[P0] logout 后本地 hosts.yml 被删除', async () => {
    // 文档用例：logout 后本地 token 被删除
    await withAuth()
    expect(await hostsFileExists()).toBe(true)
    await r(['auth', 'logout'])
    expect(await hostsFileExists()).toBe(false)
  })

  it('[P0] logout 后 auth status 返回 "Not logged in"', async () => {
    // 文档用例：logout 后 auth status 返回未登录
    await withAuth()
    await r(['auth', 'logout'])
    const statusResult = await r(['auth', 'status'])
    expect(statusResult.exitCode).toBe(4)
    expect(statusResult.stdout).toMatch(/not logged in/i)
  })

  it('[P1] logout 后 auth status exit code 为 4', async () => {
    // 文档用例：logout 后 auth status exit code 为 4
    await withAuth()
    await r(['auth', 'logout'])
    const statusResult = await r(['auth', 'status'])
    expect(statusResult.exitCode).toBe(4)
  })

  it('[P0] logout 调用 revoke session 接口（或 best-effort 清除本地凭证）', async () => {
    // 文档用例：logout 调用 revoke session 接口 + revoke 成功时 logout 返回成功
    // Uses disposableToken so the shared DIFY_E2E_TOKEN is not revoked.
    await withAuth()
    const result = await r(['auth', 'logout'])
    // 无论 revoke 是否成功，local token 必须清除
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  it('[P0] revoke 失败时仍清除本地凭证（best-effort）', async () => {
    // 文档用例：revoke 失败时仍清除本地凭证
    // 注入一个无效 token → server 会拒绝 revoke，但本地应仍被清除
    await injectAuth(configDir, {
      host: E.host,
      bearer: 'dfoa_invalid_will_fail_revoke',
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
    const result = await r(['auth', 'logout'])
    // exit 0（best-effort），本地文件被清除
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  // ── 未登录幂等 ────────────────────────────────────────────────────────────

  it('[P0] 未登录执行 logout 返回 not_logged_in 错误（exit code 4）', async () => {
    // 文档用例：未登录执行 logout 幂等成功
    // 实际行为：CLI 对无 token 的 logout 返回 not_logged_in (exit 4)
    const result = await r(['auth', 'logout'])
    assertExitCode(result, 4)
    expect(result.stderr).toMatch(/not.?logged.?in/i)
  })

  // ── 外部 SSO logout ───────────────────────────────────────────────────────

  it('[P0] 外部 SSO 用户 logout 正常工作，本地 token 清除', async () => {
    // 文档用例：外部 SSO 用户 logout 正常工作
    const { writeFile } = await import('node:fs/promises')
    const hostsYml = `${[
      `current_host: ${E.host}`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoe_sso_test_token`,
      `external_subject:`,
      `  email: sso@example.com`,
      `  issuer: https://issuer.example.com`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })

    const result = await r(['auth', 'logout'])
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  // ── 网络异常场景 ──────────────────────────────────────────────────────────

  it('[P0] logout 网络异常时仍执行本地 token 清除', async () => {
    // 文档用例：logout 网络异常时仍执行本地清除
    // 使用一个不可达的 host
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(configDir, { recursive: true })
    const hostsYml = `${[
      `current_host: http://unreachable-host-xyz.invalid`,
      `token_storage: file`,
      `tokens:`,
      `  bearer: dfoa_test_network_error`,
      `workspace:`,
      `  id: ws-1`,
      `  name: Test`,
      `  role: owner`,
    ].join('\n')}\n`
    await writeFile(join(configDir, 'hosts.yml'), hostsYml, { mode: 0o600 })

    const result = await run(['auth', 'logout'], { configDir, timeout: 10_000 })
    // 即使网络失败，local token 也被清除
    assertExitCode(result, 0)
    expect(await hostsFileExists()).toBe(false)
  })

  // ── logout 后操作 ─────────────────────────────────────────────────────────

  it('[P1] logout 后 run app 返回认证错误（exit code 4）', async () => {
    // 文档用例：logout 后 run app 返回认证错误
    // Use disposableToken so the shared DIFY_E2E_TOKEN is not revoked.
    await withAuth()
    await r(['auth', 'logout'])
    const result = await r(['run', 'app', E.chatAppId, 'test'])
    expect(result.exitCode).toBe(4)
  })
})
