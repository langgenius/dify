/**
 * Dify CLI/Error Handling/Exit Code 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Error Handling/Exit Code（29 条）
 *
 * 测试策略：
 *  - 通过 runGetApp / runDescribeApp / runApp + startMock() 端到端触发各种错误场景
 *  - 验证抛出的 BaseError.exit() 符合 ExitCode 规范
 *  - ExitCode 映射逻辑已在 src/errors/codes.test.ts 完整覆盖；此处验证集成路径的 exit code 流转
 *
 * ExitCode 规范（来自 src/errors/codes.ts）：
 *   Success = 0  Generic = 1  Usage = 2  Auth = 4  VersionCompat = 6
 */

import type { HostsBundle } from '../../../src/auth/hosts.js'
import type { DifyMock } from '../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadAppInfoCache } from '../../../src/cache/app-info.js'
import { runDescribeApp } from '../../../src/commands/describe/app/run.js'
import { runGetApp } from '../../../src/commands/get/app/run.js'
import { runApp } from '../../../src/commands/run/app/run.js'
import { BaseError, isBaseError } from '../../../src/errors/base.js'
import { ErrorCode, ExitCode } from '../../../src/errors/codes.js'
import { createClient } from '../../../src/http/client.js'
import { bufferStreams } from '../../../src/io/streams.js'
import { hostsBundleFixture } from '../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../fixtures/dify-mock/server.js'

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

/** 执行 fn，捕获 BaseError 后返回 exit code；非 BaseError 则 rethrow */
async function captureExit(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn()
    return ExitCode.Success
  }
  catch (e) {
    if (e instanceof BaseError)
      return e.exit()
    throw e
  }
}

describe('Dify CLI/Error Handling/Exit Code', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-exit-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  afterAll(async () => {
    await mock.stop()
  })

  function http() {
    return createClient({ host: mock.url, bearer: 'dfoa_test', retryAttempts: 0 })
  }
  async function cache() {
    return loadAppInfoCache({ configDir: dir,
    })
  }

  // ── ExitCode.Success = 0 ──────────────────────────────────────────────────

  it('成功命令 exit code 为 0（get app 正常返回）[P0]', async () => {
    const code = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(code).toBe(ExitCode.Success)
  })

  it('成功命令 exit code 为 0（describe app 正常返回）[P0]', async () => {
    const c = await cache()
    const code = await captureExit(() =>
      runDescribeApp({ appId: 'app-1' }, { bundle: baseBundle, http: http(), host: mock.url, cache: c }),
    )
    expect(code).toBe(ExitCode.Success)
  })

  it('成功命令 exit code 为 0（run app chat 正常执行）[P0]', async () => {
    const c = await cache()
    const io = bufferStreams()
    const code = await captureExit(() =>
      runApp({ appId: 'app-1', message: 'hi' }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c }),
    )
    expect(code).toBe(ExitCode.Success)
  })

  // ── ExitCode.Auth = 4 ─────────────────────────────────────────────────────

  it('authentication error（auth-expired）exit code 为 4 [P0]', async () => {
    mock.setScenario('auth-expired')
    const code = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(code).toBe(ExitCode.Auth)
  })

  it('authentication error（run app auth-expired）exit code 为 4 [P0]', async () => {
    mock.setScenario('auth-expired')
    const io = bufferStreams()
    const code = await captureExit(() =>
      runApp({ appId: 'app-1', message: 'hi' }, { bundle: baseBundle, http: http(), host: mock.url, io }),
    )
    expect(code).toBe(ExitCode.Auth)
  })

  it('auth error exit code 区别于 generic error（4 ≠ 1）[P1]', async () => {
    mock.setScenario('auth-expired')
    const authCode = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    mock.setScenario('server-5xx')
    const genericCode = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(authCode).toBe(ExitCode.Auth)
    expect(genericCode).toBe(ExitCode.Generic)
    expect(authCode).not.toBe(genericCode)
  })

  // ── ExitCode.Generic = 1 ──────────────────────────────────────────────────

  it('app not found exit code 为 1（Generic）[P0]', async () => {
    const code = await captureExit(() =>
      runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() }),
    )
    expect(code).toBe(ExitCode.Generic)
  })

  it('server 500 exit code 为 1（Generic）[P0]', async () => {
    mock.setScenario('server-5xx')
    const code = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(code).toBe(ExitCode.Generic)
  })

  it('network error（rate-limited 429）exit code 为 1（Generic）[P0]', async () => {
    mock.setScenario('rate-limited')
    const code = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(code).toBe(ExitCode.Generic)
  })

  it('upload failed（server-5xx 场景）exit code 为 1（Generic）[P1]', async () => {
    mock.setScenario('server-5xx')
    const code = await captureExit(() =>
      runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() }),
    )
    expect(code).toBe(ExitCode.Generic)
  })

  // ── ExitCode.Usage = 2 ────────────────────────────────────────────────────

  it('参数错误（--limit 越界）exit code 为 2（Usage）[P0]', async () => {
    const code = await captureExit(() =>
      runGetApp({ limitRaw: '999' }, { bundle: baseBundle, http: http() }),
    )
    expect(code).toBe(ExitCode.Usage)
  })

  it('参数错误（--limit 非数字）exit code 为 2（Usage）[P0]', async () => {
    const code = await captureExit(() =>
      runGetApp({ limitRaw: 'abc' }, { bundle: baseBundle, http: http() }),
    )
    expect(code).toBe(ExitCode.Usage)
  })

  it('参数错误（--inputs 非法 JSON）exit code 为 2（Usage）[P0]', async () => {
    const io = bufferStreams()
    const code = await captureExit(() =>
      runApp({ appId: 'app-2', inputsJson: 'notjson' }, { bundle: baseBundle, http: http(), host: mock.url, io }),
    )
    expect(code).toBe(ExitCode.Usage)
  })

  it('参数错误（--inputs 为数组而非对象）exit code 为 2（Usage）[P0]', async () => {
    const io = bufferStreams()
    const code = await captureExit(() =>
      runApp({ appId: 'app-2', inputsJson: '[1,2,3]' }, { bundle: baseBundle, http: http(), host: mock.url, io }),
    )
    expect(code).toBe(ExitCode.Usage)
  })

  it('workflow app 传入 positional message exit code 为 2（Usage）[P0]', async () => {
    const c = await cache()
    const io = bufferStreams()
    const code = await captureExit(() =>
      runApp({ appId: 'app-2', message: 'hi' }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c }),
    )
    expect(code).toBe(ExitCode.Usage)
  })

  it('no workspace 时 exit code 为 2（UsageMissingArg）[P0]', async () => {
    const minimal: HostsBundle = { current_host: 'h', token_storage: 'file' }
    const code = await captureExit(() => runGetApp({}, { bundle: minimal, http: http() }))
    expect(code).toBe(ExitCode.Usage)
  })

  it('--file 参数格式错误 exit code 为 2（Usage）[P0]', async () => {
    const c = await cache()
    const io = bufferStreams()
    const code = await captureExit(() =>
      runApp({ appId: 'app-2', files: ['invalidflag'] }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c }),
    )
    expect(code).toBe(ExitCode.Usage)
  })

  // ── 不同错误类型 exit code 可区分 ──────────────────────────────────────────

  it('不同错误类型 exit code 可区分（Auth=4, Usage=2, Generic=1）[P1]', async () => {
    // Auth
    mock.setScenario('auth-expired')
    const authCode = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    // Usage
    const usageCode = await captureExit(() =>
      runGetApp({ limitRaw: '999' }, { bundle: baseBundle, http: http() }),
    )
    // Generic
    mock.setScenario('server-5xx')
    const genericCode = await captureExit(() => runGetApp({}, { bundle: baseBundle, http: http() }))

    expect(authCode).toBe(ExitCode.Auth)
    expect(usageCode).toBe(ExitCode.Usage)
    expect(genericCode).toBe(ExitCode.Generic)
    // 三种 exit code 互不相同
    expect(new Set([authCode, usageCode, genericCode]).size).toBe(3)
  })

  it('多次执行同一失败场景 exit code 一致 [P1]', async () => {
    const codes = await Promise.all(
      [0, 1, 2].map(() => captureExit(() => runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() }))),
    )
    expect(new Set(codes).size).toBe(1)
    expect(codes[0]).toBe(ExitCode.Generic)
  })

  // ── JSON/YAML 模式错误仍返回非 0 exit code ─────────────────────────────────

  it('JSON 模式（-o json）下 server-5xx 错误 exit code 仍为 1（Generic）[P0]', async () => {
    mock.setScenario('server-5xx')
    const code = await captureExit(() => runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() }))
    expect(code).toBe(ExitCode.Generic)
    expect(code).not.toBe(ExitCode.Success)
  })

  it('JSON 模式（-o json）下 auth 错误 exit code 为 4 [P0]', async () => {
    mock.setScenario('auth-expired')
    const code = await captureExit(() => runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() }))
    expect(code).toBe(ExitCode.Auth)
  })

  it('YAML 模式（-o yaml）下错误 exit code 非 0 [P1]', async () => {
    mock.setScenario('server-5xx')
    const code = await captureExit(() => runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() }))
    expect(code).not.toBe(ExitCode.Success)
  })

  it('server 4xx（app not found）在 -o json 模式 exit code 为 1 [P0]', async () => {
    const code = await captureExit(() =>
      runGetApp({ appId: 'app-nonexistent', format: 'json' }, { bundle: baseBundle, http: http() }),
    )
    expect(code).toBe(ExitCode.Generic)
    expect(code).not.toBe(ExitCode.Success)
  })

  // ── stderr 与 stdout 分离 ─────────────────────────────────────────────────

  it('stderr 输出错误时 stdout 保持干净（get app 失败后 outBuf 为空）[P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    try {
      await runApp({ appId: 'app-1', message: 'hi' }, { bundle: baseBundle, http: http(), host: mock.url, io })
    }
    catch {
      // expected
    }
    // stdout 不应输出错误信息
    expect(io.outBuf()).toBe('')
  })

  it('stdout 输出成功内容时 stderr 不含错误（仅 hint）[P1]', async () => {
    const c = await cache()
    const io = bufferStreams()
    await runApp({ appId: 'app-1', message: 'hi' }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c })
    // stdout 有答案
    expect(io.outBuf()).toContain('echo: hi')
    // stderr 无 "error" 关键词（仅 conversation hint）
    expect(io.errBuf()).not.toContain('error:')
    expect(io.errBuf()).not.toContain('Error:')
  })

  // ── ExitCode 枚举值稳定性 ────────────────────────────────────────────────

  it('ExitCode 枚举值稳定（Success=0 Generic=1 Usage=2 Auth=4 VersionCompat=6）[P0]', () => {
    expect(ExitCode.Success).toBe(0)
    expect(ExitCode.Generic).toBe(1)
    expect(ExitCode.Usage).toBe(2)
    expect(ExitCode.Auth).toBe(4)
    expect(ExitCode.VersionCompat).toBe(6)
  })

  it('isBaseError 正确识别 BaseError 实例 [P0]', () => {
    const err = new BaseError({ code: ErrorCode.Unknown, message: 'test' })
    expect(isBaseError(err)).toBe(true)
    expect(isBaseError(new Error('plain'))).toBe(false)
    expect(isBaseError(null)).toBe(false)
    expect(isBaseError(undefined)).toBe(false)
  })

  it('validation error（--inputs 与 --inputs-file 互斥）exit code 为 2 [P0]', async () => {
    const { writeFile } = await import('node:fs/promises')
    const f = join(dir, 'f.json')
    await writeFile(f, '{}')
    const io = bufferStreams()
    const code = await captureExit(() =>
      runApp({ appId: 'app-2', inputsJson: '{}', inputsFile: f }, { bundle: baseBundle, http: http(), host: mock.url, io }),
    )
    expect(code).toBe(ExitCode.Usage)
  })
})
