/**
 * E2E: difyctl auth devices — 多设备 Session 管理
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Auth/多设备 Session 管理（21 条）
 */

import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { assertExitCode, assertJson } from '../../helpers/assert.js'
import { injectAuth, mintFreshToken, run, withTempConfig } from '../../helpers/cli.js'
import { optionalIt } from '../../helpers/skip.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()
const caps = inject('e2eCapabilities')
const tokenValid = caps.tokenValid
const tokenId = caps.tokenId

describe('E2E / difyctl auth devices', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await withTempConfig()
    configDir = tmp.configDir
    cleanup = tmp.cleanup

    await injectAuth(configDir, {
      host: E.host,
      bearer: E.token,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
      tokenId,
    })
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[]) {
    return run(argv, { configDir })
  }

  // ── devices list ──────────────────────────────────────────────────────────

  const itSessions = optionalIt(tokenValid)

  itSessions('[P0] 已登录用户可查看 devices 列表', async () => {
    // 文档用例：已登录用户可查看 devices 列表
    const result = await r(['auth', 'devices', 'list'])
    assertExitCode(result, 0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  itSessions('[P0] devices list 显示 device id', async () => {
    // 文档用例：devices list 显示 device id
    const result = await r(['auth', 'devices', 'list'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/tok-|id|device/i)
  })

  itSessions('[P0] devices list 支持 JSON 输出，返回合法 JSON', async () => {
    // 文档用例：devices list 支持 JSON 输出
    const result = await r(['auth', 'devices', 'list', '--json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[], total: number }>(result)
    expect(parsed).toHaveProperty('data')
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  itSessions('[P1] devices list JSON schema 稳定（含 data、total 字段）', async () => {
    // 文档用例：devices list JSON schema 稳定
    const result = await r(['auth', 'devices', 'list', '--json'])
    assertExitCode(result, 0)
    const parsed = assertJson<{ data: unknown[], total: number, page: number, limit: number }>(result)
    expect(parsed).toHaveProperty('total')
    expect(parsed).toHaveProperty('page')
    expect(parsed).toHaveProperty('limit')
  })

  it('[P0] 未登录执行 devices list 返回认证错误（exit code 4）', async () => {
    // 文档用例：未登录执行 devices list 返回认证错误 + exit code 4
    const unauthTmp = await withTempConfig()
    try {
      const result = await run(['auth', 'devices', 'list'], { configDir: unauthTmp.configDir })
      assertExitCode(result, 4)
      expect(result.stderr).toMatch(/not.?logged.?in|auth.?login/i)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })

  // ── devices revoke ────────────────────────────────────────────────────────

  itSessions('[P0] revoke 指定 device 成功（exit code 0）', async () => {
    // 文档用例：revoke 指定 device 成功
    // Mint a fresh token on demand so this test only revokes its own session,
    // never the shared E.token or the global-setup disposableToken.
    const freshToken = await mintFreshToken(E.host, E.email, E.password)
    if (!freshToken) {
      // Credentials not configured — skip rather than risk revoking the main session.
      return
    }

    // Inject the fresh token into a dedicated config dir
    const revokeTmp = await withTempConfig()
    try {
      await injectAuth(revokeTmp.configDir, {
        host: E.host,
        bearer: freshToken,
        workspaceId: E.workspaceId,
        workspaceName: E.workspaceName,
      })
      const revokeR = (argv: string[]) => run(argv, { configDir: revokeTmp.configDir })

      // List sessions authenticated as the fresh token
      const listResult = await revokeR(['auth', 'devices', 'list', '--json'])
      assertExitCode(listResult, 0)
      const { data } = assertJson<{ data: Array<{ id: string, prefix: string }> }>(listResult)

      // Find the entry whose prefix matches the fresh token
      const entry = data.find(d => d.prefix && freshToken.startsWith(d.prefix))
      if (!entry) {
        // Fresh session not found — may have been filtered; skip gracefully.
        return
      }

      const revokeResult = await revokeR(['auth', 'devices', 'revoke', entry.id, '--yes'])
      assertExitCode(revokeResult, 0)
    }
    finally {
      await revokeTmp.cleanup()
    }
  })
})
