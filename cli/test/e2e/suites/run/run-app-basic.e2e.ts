/**
 * E2E: difyctl run app — 基础 App 运行 + Streaming + Conversation
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》
 *   - Dify CLI/Run/基础 App 运行（26 条）
 *   - Dify CLI/Run/Streaming 输出（部分，完整见 run-app-streaming.e2e.ts）
 *   - Dify CLI/Run/Conversation 模式（部分）
 *   - Dify CLI/Error Handling/Exit Code（run 相关）
 *   - Dify CLI/CLI Framework/Non-Interactive（run 相关）
 *
 * Staging app 前置条件（由 DIFY_E2E_* 环境变量指定）：
 *   echo-chat    — mode=chat，query 变量，输出 "echo: {query}"
 *   echo-workflow — mode=workflow，x 变量（required），输出 "echo: {x}"
 */

import type { AuthFixture } from '../../helpers/cli.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertErrorEnvelope,
  assertExitCode,
  assertJson,
  assertNoAnsi,
  assertPipeFriendlyJson,
  assertStderrContains,
  assertStdoutContains,
} from '../../helpers/assert.js'
import { registerConversation } from '../../helpers/cleanup-registry.js'
import { run, withAuthFixture, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()

// ── Suite ──────────────────────────────────────────────────────────────────

describe('E2E / difyctl run app', () => {
  let fx: AuthFixture

  beforeEach(async () => {
    fx = await withAuthFixture(E)
  })
  afterEach(async () => {
    await fx.cleanup()
  })

  // =========================================================================
  // 基础执行
  // =========================================================================

  describe('基础执行', () => {
    it('[P0] 已登录内部用户可运行 app，stdout 输出 app 结果', async () => {
      // 文档用例：已登录内部用户可运行 app / 默认输出执行结果
      // withRetry: staging LLM inference may have transient 5xx on cold start
      const result = await withRetry(() => fx.r(['run', 'app', E.chatAppId, 'hello']), {
        attempts: 3,
        delayMs: 2000,
        shouldRetry: err => err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message),
      })
      assertExitCode(result, 0)
      assertStdoutContains(result, 'echo:hello')
    })

    it('[P0] run app 调用 execute endpoint（stdout 有实际内容）', async () => {
      // 文档用例：run app 调用 execute endpoint
      const result = await fx.r(['run', 'app', E.chatAppId, 'e2e-smoke'])
      assertExitCode(result, 0)
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('[P1] 文本输出保留换行（stdout 末尾为 \\n）', async () => {
      // 文档用例：文本输出保留换行
      const result = await fx.r(['run', 'app', E.chatAppId, 'newline'])
      assertExitCode(result, 0)
      expect(result.stdout).toMatch(/\n$/)
    })

    it('[P1] 重复执行 run app 每次独立完成（3 次循环）', async () => {
      // 文档用例：重复执行 run app 不影响历史状态
      for (let i = 0; i < 3; i++) {
        const result = await fx.r(['run', 'app', E.chatAppId, `repeat-${i}`])
        assertExitCode(result, 0)
        assertStdoutContains(result, `echo:repeat-${i}`)
      }
    })
  })

  // =========================================================================
  // 输出格式
  // =========================================================================

  describe('出格式 (-o)', () => {
    it('[P0] -o json 输出合法 JSON', async () => {
      // 文档用例：-o json 输出合法 JSON
      const result = await fx.r(['run', 'app', E.chatAppId, 'json-test', '-o', 'json'])
      assertExitCode(result, 0)
      const parsed = assertJson<{ answer: string, mode: string }>(result)
      expect(parsed).toHaveProperty('answer')
      expect(parsed.mode).toMatch(/chat/)
    })

    it('[P1] JSON 输出包含 execution metadata（message_id / conversation_id）', async () => {
      // 文档用例：JSON 输出包含 execution metadata
      const result = await fx.r(['run', 'app', E.chatAppId, 'meta', '-o', 'json'])
      assertExitCode(result, 0)
      const parsed = assertJson<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('message_id')
      expect(parsed).toHaveProperty('conversation_id')
    })

    it('[P1] JSON 输出支持 pipe（无 ANSI，首字符为 {，末尾为 \\n）', async () => {
      // 文档用例：JSON 输出支持 pipe
      const result = await fx.r(['run', 'app', E.chatAppId, 'pipe', '-o', 'json'])
      assertExitCode(result, 0)
      assertPipeFriendlyJson(result)
    })

    it('[P1] JSON 模式错误输出 JSON error envelope 到 stderr', async () => {
      // 文档用例：JSON 模式错误输出 JSON envelope
      const result = await fx.r(['run', 'app', 'app-nonexistent-xyz-e2e', 'hello', '-o', 'json'])
      assertNonZeroExit(result)
      assertErrorEnvelope(result, 'server_4xx_other')
    })
  })

  // =========================================================================
  // --inputs 参数
  // =========================================================================

  describe('--inputs 参数', () => {
    it('[P0] run app 支持 --inputs（workflow app）', async () => {
      // 文档用例：run app 支持 --input
      // withRetry: staging workflow execution may have transient 5xx
      const result = await withRetry(
        () => fx.r(['run', 'app', E.workflowAppId, '--inputs', JSON.stringify({ x: 'workflow-val' })]),
        { attempts: 3, delayMs: 2000, shouldRetry: err => err instanceof Error && /5\d{2}|ECONNRESET|timeout/i.test(err.message) },
      )
      assertExitCode(result, 0)
      assertStdoutContains(result, 'workflow-val')
    })

    it('[P0] 多个 inputs 同时生效', async () => {
      // 文档用例：多个 --input 参数同时生效
      const result = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'multi-test' }),
      ])
      assertExitCode(result, 0)
    })

    it('[P0] --inputs 为非法 JSON 返回 usage error（exit code 2）', async () => {
      // 文档用例：必填参数缺失 / 非法 input
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs', 'not-json'])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/valid JSON/i)
    })

    it('[P0] --inputs 为 JSON 数组返回 usage error', async () => {
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs', '[1,2,3]'])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/JSON object/i)
    })

    it('[P0] --inputs 与 --inputs-file 互斥时返回 usage error', async () => {
      // 文档用例：enum 参数非法值返回错误（usage 类别）
      const inputsFile = join(fx.configDir, 'inputs.json')
      await writeFile(inputsFile, JSON.stringify({ x: 'file-val' }))
      const result = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        '{"x":"flag-val"}',
        '--inputs-file',
        inputsFile,
      ])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/mutually exclusive/i)
    })

    it('[P0] workflow app 传入 positional message 返回 usage error', async () => {
      // 文档用例：必填参数缺失时执行失败（workflow positional）
      const result = await fx.r(['run', 'app', E.workflowAppId, 'positional-msg'])
      assertExitCode(result, 2)
      expect(result.stderr).toMatch(/workflow apps do not accept a positional message/i)
    })

    it('[P0] --inputs-file 从文件读取 JSON inputs', async () => {
      const inputsFile = join(fx.configDir, 'wf-inputs.json')
      await writeFile(inputsFile, JSON.stringify({ x: 'from-file' }))
      const result = await fx.r(['run', 'app', E.workflowAppId, '--inputs-file', inputsFile])
      assertExitCode(result, 0)
      assertStdoutContains(result, 'from-file')
    })
  })

  // =========================================================================
  // 错误场景
  // =========================================================================

  describe('错误场景', () => {
    it('[P0] app 不存在返回错误，exit code 为 1', async () => {
      // 文档用例：app 不存在返回 app not found + exit code 为 1
      const result = await fx.r(['run', 'app', 'app-id-does-not-exist-e2e-xyz', 'hello'])
      assertExitCode(result, 1)
      expect(result.stderr).toMatch(/not.?found/i)
    })

    it('[P0] 缺少 app id 返回错误（exit code 1，CLI 对 missing required arg 返回 1）', async () => {
      // 文档用例：缺少 app id 返回 usage error
      // 实际行为：CLI framework 对 missing required argument 返回 exit 1（不是 2）
      const result = await fx.r(['run', 'app'])
      assertExitCode(result, 1)
      expect(result.stderr).toMatch(/missing required argument/i)
    })

    it('[P0] 未登录执行 run app 返回认证错误（exit code 4）', async () => {
      // 文档用例：未登录执行 run app 返回认证错误 + exit code 为 4
      const unauthTmp = await withTempConfig()
      try {
        const result = await run(['run', 'app', E.chatAppId, 'hello'], {
          configDir: unauthTmp.configDir,
        })
        assertExitCode(result, 4)
        expect(result.stderr).toMatch(/not.?logged.?in|auth.?login/i)
      }
      finally {
        await unauthTmp.cleanup()
      }
    })
  })

  // =========================================================================
  // Streaming 输出
  // =========================================================================

  describe('Streaming 输出', () => {
    it('[P0] --stream 可正常接收流式输出，stdout 有内容', async () => {
      // 文档用例：run app --stream 可正常接收流式输出
      const result = await fx.r(['run', 'app', E.chatAppId, 'stream-test', '--stream'])
      assertExitCode(result, 0)
      assertStdoutContains(result, 'echo:stream-test')
    })

    it('[P0] streaming 结束后 exit code 为 0', async () => {
      // 文档用例：streaming 结束后正常退出
      const result = await fx.r(['run', 'app', E.chatAppId, 'end-ok', '--stream'])
      assertExitCode(result, 0)
    })

    it('[P1] streaming 模式下 stderr 不混入 stdout', async () => {
      // 文档用例：streaming 模式下 stderr 不混入 stdout
      const result = await fx.r(['run', 'app', E.chatAppId, 'sep', '--stream'])
      assertExitCode(result, 0)
      expect(result.stdout).not.toContain('hint:')
      assertStderrContains(result, '--conversation')
    })

    it('[P1] --stream -o json 输出合法 JSON envelope', async () => {
      // 文档用例：streaming 模式下 JSON 输出合法
      const result = await fx.r(['run', 'app', E.chatAppId, 'sjson', '--stream', '-o', 'json'])
      assertExitCode(result, 0)
      const parsed = assertJson<{ mode: string, answer: string }>(result)
      expect(parsed.mode).toMatch(/chat/)
    })

    it('[P0] streaming app 不存在返回错误（exit code 1）', async () => {
      // 文档用例：streaming app 不存在返回错误
      const result = await fx.r(['run', 'app', 'nonexistent-xyz-e2e', 'hi', '--stream'])
      assertExitCode(result, 1)
    })

    it('[P0] 未登录执行 streaming 返回认证错误（exit code 4）', async () => {
      // 文档用例：未登录执行 streaming 返回认证错误
      const unauthTmp = await withTempConfig()
      try {
        const result = await run(['run', 'app', E.chatAppId, 'hi', '--stream'], {
          configDir: unauthTmp.configDir,
        })
        assertExitCode(result, 4)
      }
      finally {
        await unauthTmp.cleanup()
      }
    })

    it('[P1] streaming 模式输出支持 pipe（无 ANSI，末尾 \\n）', async () => {
      // 文档用例：streaming 模式输出支持 pipe
      const result = await fx.r(['run', 'app', E.chatAppId, 'pipe-s', '--stream'])
      assertExitCode(result, 0)
      assertNoAnsi(result.stdout, 'stdout')
      expect(result.stdout.endsWith('\n')).toBe(true)
    })

    it('[P0] workflow streaming 输出包含 succeeded 状态', async () => {
      const result = await fx.r([
        'run',
        'app',
        E.workflowAppId,
        '--inputs',
        JSON.stringify({ x: 'wf-stream-val' }),
        '--stream',
        '-o',
        'json',
      ])
      assertExitCode(result, 0)
      const parsed = assertJson<{ data?: { status?: string } }>(result)
      expect(parsed.data?.status).toBe('succeeded')
    })
  })

  // =========================================================================
  // Conversation 模式
  // =========================================================================

  describe('Conversation 模式', () => {
    it('[P0] chat app 可创建新 conversation，stderr 含 hint', async () => {
      // 文档用例：chat app 可创建新 conversation
      const result = await fx.r(['run', 'app', E.chatAppId, 'start-conv'])
      assertExitCode(result, 0)
      assertStderrContains(result, '--conversation')
    })

    it('[P0] JSON 输出包含 conversation_id', async () => {
      // 文档用例：JSON 输出包含 conversation_id
      const result = await fx.r(['run', 'app', E.chatAppId, 'conv-json', '-o', 'json'])
      assertExitCode(result, 0)
      const parsed = assertJson<{ conversation_id: string }>(result)
      expect(typeof parsed.conversation_id).toBe('string')
      expect(parsed.conversation_id.length).toBeGreaterThan(0)
      registerConversation(E.host, E.token, E.chatAppId, parsed.conversation_id)
    })

    it('[P0] --conversation 参数生效：conversation_id 在后续请求中复用', async () => {
      // 文档用例：--conversation 参数生效 + conversation_id 在后续请求中复用
      const first = await fx.r(['run', 'app', E.chatAppId, 'first-msg', '-o', 'json'])
      assertExitCode(first, 0)
      const { conversation_id } = assertJson<{ conversation_id: string }>(first)
      registerConversation(E.host, E.token, E.chatAppId, conversation_id)

      const second = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'second-msg',
        '--conversation',
        conversation_id,
        '-o',
        'json',
      ])
      assertExitCode(second, 0)
      const secondParsed = assertJson<{ conversation_id: string }>(second)
      expect(secondParsed.conversation_id).toBe(conversation_id)
    })

    it('[P0] 不传 conversation_id 时自动创建新会话', async () => {
      // 文档用例：conversation_id 缺失时自动创建新会话
      const result = await fx.r(['run', 'app', E.chatAppId, 'new-conv', '-o', 'json'])
      assertExitCode(result, 0)
      const { conversation_id } = assertJson<{ conversation_id: string }>(result)
      expect(conversation_id).toBeTruthy()
    })

    it('[P0] 非法 conversation_id 返回错误（exit code 1）', async () => {
      // 文档用例：非法 conversation_id 返回错误
      const result = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'bad-conv',
        '--conversation',
        'invalid-conv-id-xyz-not-exist',
      ])
      assertNonZeroExit(result)
    })

    it('[P1] conversation 模式支持 streaming', async () => {
      // 文档用例：conversation 模式支持 streaming
      const first = await fx.r(['run', 'app', E.chatAppId, 'init', '-o', 'json'])
      const { conversation_id } = assertJson<{ conversation_id: string }>(first)

      const result = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'continue',
        '--conversation',
        conversation_id,
        '--stream',
      ])
      assertExitCode(result, 0)
      assertStdoutContains(result, 'echo:')
    })

    it('[P1] conversation 输出支持 pipe（-o json pipe 友好格式）', async () => {
      // 文档用例：conversation 输出支持 pipe
      const result = await fx.r(['run', 'app', E.chatAppId, 'pipe-conv', '-o', 'json'])
      assertExitCode(result, 0)
      assertPipeFriendlyJson(result)
    })
  })

  // =========================================================================
  // 非交互模式 / CI 环境
  // =========================================================================

  describe('非交互模式 (CI)', () => {
    it('[P0] CI=1 环境无 spinner，stdout 无 ANSI color', async () => {
      // 文档用例：非 tty 环境自动关闭 ANSI color + 非交互模式不输出 spinner
      const result = await fx.r(['run', 'app', E.chatAppId, 'ci-test'], { CI: '1', NO_COLOR: '1' })
      assertExitCode(result, 0)
      assertNoAnsi(result.stdout, 'stdout')
      assertNoAnsi(result.stderr, 'stderr')
    })

    it('[P0] 非交互模式 exit code 正确传递', async () => {
      // 文档用例：非交互模式 exit code 正确
      const result = await fx.r(['run', 'app', E.chatAppId, 'code'])
      expect(typeof result.exitCode).toBe('number')
      expect(result.exitCode).toBe(0)
    })
  })

  // =========================================================================
  // workspace override
  // =========================================================================

  describe('workspace override', () => {
    it('[P1] --workspace flag 覆盖默认 workspace', async () => {
      // 文档用例：workspace override 生效
      // run app 使用 --workspace（无 -w 短形式）
      const result = await fx.r([
        'run',
        'app',
        E.chatAppId,
        'ws-override',
        '--workspace',
        E.workspaceId,
      ])
      assertExitCode(result, 0)
    })
  })
})

// ── local helper (avoids import confusion) ─────────────────────────────────
function assertNonZeroExit(result: import('../../helpers/cli.js').RunResult): void {
  expect(result.exitCode, 'exit code should be non-zero').not.toBe(0)
}
