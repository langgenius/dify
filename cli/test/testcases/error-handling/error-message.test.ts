/**
 * Dify CLI/Error Handling/错误消息规范 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Error Handling/错误消息规范（32 条）
 *
 * 覆盖策略：
 *  - 验证 BaseError 的 code / message / hint 字段内容符合规范
 *  - 验证 toEnvelope / renderEnvelope 的 JSON schema（{ error: { code, message } }）
 *  - 验证 formatErrorForCli 在 JSON 模式下的输出格式
 *  - 验证敏感信息不泄露（redactBearer）
 *  - 验证 stderr/stdout 流隔离
 *  - 标注 WTA-249/WTA-255/WTA-257 等已知缺陷
 */

import type { HostsBundle } from '../../../src/auth/hosts.js'
import type { DifyMock } from '../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAppInfoCache } from '../../../src/cache/app-info.js'
import { runGetApp } from '../../../src/commands/get/app/run.js'
import { runApp } from '../../../src/commands/run/app/run.js'
import { BaseError } from '../../../src/errors/base.js'
import { ErrorCode } from '../../../src/errors/codes.js'
import { renderEnvelope, toEnvelope } from '../../../src/errors/envelope.js'
import { formatErrorForCli } from '../../../src/errors/format.js'
import { createClient } from '../../../src/http/client.js'
import { redactBearer } from '../../../src/http/sanitize.js'
import { bufferStreams } from '../../../src/io/streams.js'
import { hostsBundleFixture } from '../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../fixtures/dify-mock/server.js'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHFA-DJsuhl]/
function hasAnsi(s: string): boolean {
  return ANSI_RE.test(s)
}

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

/** 触发失败命令，捕获 BaseError 并返回 */
async function captureError(fn: () => Promise<unknown>): Promise<BaseError> {
  try {
    await fn()
    throw new Error('expected command to fail but it succeeded')
  }
  catch (e) {
    if (e instanceof BaseError)
      return e
    throw e
  }
}

describe('Dify CLI/Error Handling/错误消息规范', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-errmsg-'))
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

  // ── 参数错误消息 ──────────────────────────────────────────────────────────

  it('参数错误返回 code=usage_invalid_flag，message 明确描述原因 [P0]', async () => {
    const err = await captureError(() => runGetApp({ limitRaw: 'abc' }, { bundle: baseBundle, http: http() }))
    expect(err.code).toBe(ErrorCode.UsageInvalidFlag)
    expect(err.message).toMatch(/is not a number/)
  })

  it('--limit 越界返回 usage_invalid_flag，message 含 out of range [P0]', async () => {
    const err = await captureError(() => runGetApp({ limitRaw: '999' }, { bundle: baseBundle, http: http() }))
    expect(err.code).toBe(ErrorCode.UsageInvalidFlag)
    expect(err.message).toMatch(/out of range/)
  })

  it('no workspace 返回 usage_missing_arg，message 含 no workspace [P0]', async () => {
    const minimal: HostsBundle = { current_host: 'h', token_storage: 'file' }
    const err = await captureError(() => runGetApp({}, { bundle: minimal, http: http() }))
    expect(err.code).toBe(ErrorCode.UsageMissingArg)
    expect(err.message).toMatch(/no workspace/)
  })

  it('workflow app + positional message 返回 usage_invalid_flag，hint 建议用 --inputs [P0]', async () => {
    const c = await cache()
    const io = bufferStreams()
    const err = await captureError(() =>
      runApp({ appId: 'app-2', message: 'hi' }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c }),
    )
    expect(err.code).toBe(ErrorCode.UsageInvalidFlag)
    expect(err.hint).toMatch(/--inputs/)
  })

  it('--file 参数格式错误返回 usage_invalid_flag，message 含 key=@path [P0]', async () => {
    const c = await cache()
    const io = bufferStreams()
    const err = await captureError(() =>
      runApp({ appId: 'app-2', files: ['invalidflag'] }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c }),
    )
    expect(err.code).toBe(ErrorCode.UsageInvalidFlag)
    expect(err.message).toContain('--file must be key=@path')
  })

  it('--inputs 为 JSON 数组时返回 usage_invalid_flag，message 含 JSON object [P0]', async () => {
    const io = bufferStreams()
    const err = await captureError(() =>
      runApp({ appId: 'app-2', inputsJson: '[1,2]' }, { bundle: baseBundle, http: http(), host: mock.url, io }),
    )
    expect(err.code).toBe(ErrorCode.UsageInvalidFlag)
    expect(err.message).toMatch(/JSON object/)
  })

  it('--inputs 与 --inputs-file 互斥错误 message 含 mutually exclusive [P0]', async () => {
    const { writeFile } = await import('node:fs/promises')
    const f = join(dir, 'f.json')
    await writeFile(f, '{}')
    const io = bufferStreams()
    const err = await captureError(() =>
      runApp({ appId: 'app-2', inputsJson: '{}', inputsFile: f }, { bundle: baseBundle, http: http(), host: mock.url, io }),
    )
    expect(err.message).toMatch(/mutually exclusive/)
  })

  // ── authentication / network 错误消息 ────────────────────────────────────

  it('authentication error（auth-expired）code=auth_expired，message 不为空 [P0]', async () => {
    mock.setScenario('auth-expired')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(err.code).toBe(ErrorCode.AuthExpired)
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('authentication error hint 建议重新登录 [P0]', async () => {
    mock.setScenario('auth-expired')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(err.hint).toMatch(/auth login/)
  })

  it('server 500 error code=server_5xx，message 不为空 [P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(err.code).toBe(ErrorCode.Server5xx)
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('server 500 错误不暴露内部 stack trace（message 不含 at … js:）[P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(err.message).not.toMatch(/at\s+\S+\.js:\d+/)
  })

  it('app not found 返回 server_4xx_other，httpStatus 为 404 [P0]', async () => {
    const err = await captureError(() =>
      runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() }),
    )
    expect(err.code).toBe(ErrorCode.Server4xxOther)
    expect(err.httpStatus).toBe(404)
  })

  it('app not found message 包含 not found [P0]', async () => {
    const err = await captureError(() =>
      runGetApp({ appId: 'app-nonexistent' }, { bundle: baseBundle, http: http() }),
    )
    expect(err.message.toLowerCase()).toContain('not found')
  })

  it('文件不存在上传失败 message 包含文件路径和上下文信息 [P0]', async () => {
    const c = await cache()
    const io = bufferStreams()
    const err = await captureError(() =>
      runApp({ appId: 'app-2', files: ['doc=@/nonexistent/path/file.txt'] }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c }),
    )
    expect(err.message).toContain('/nonexistent/path/file.txt')
  })

  // ── BaseError 字段内容规范 ────────────────────────────────────────────────

  it('BaseError.code 始终为 ErrorCode 枚举中的值 [P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const allCodes = Object.values(ErrorCode) as string[]
    expect(allCodes).toContain(err.code)
  })

  it('BaseError.httpStatus 在 HTTP 错误场景下为正整数 [P0]', async () => {
    mock.setScenario('auth-expired')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(err.httpStatus).toBeDefined()
    expect(err.httpStatus).toBeGreaterThan(0)
    expect(err.httpStatus).toBe(401)
  })

  it('BaseError.method 和 url 在 HTTP 错误场景下被填充 [P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    expect(err.method).toBeDefined()
    expect(err.url).toBeDefined()
    expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(err.method)
  })

  it('BaseError.url 不含明文 Bearer token（redactBearer 已应用）[P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    if (err.url !== undefined) {
      expect(err.url).not.toMatch(/dfoa_[a-z0-9]+/i)
      expect(err.url).not.toMatch(/Bearer\s+dfo[ae]_/)
    }
  })

  // ── toEnvelope / renderEnvelope JSON schema ───────────────────────────────

  it('toEnvelope 结构为 { error: { code, message } } [P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const envelope = toEnvelope(err)
    expect(envelope).toHaveProperty('error')
    expect(envelope.error).toHaveProperty('code')
    expect(envelope.error).toHaveProperty('message')
  })

  it('JSON error 包含 code 字段，且为非空字符串 [P0]', async () => {
    mock.setScenario('auth-expired')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const envelope = toEnvelope(err)
    expect(typeof envelope.error.code).toBe('string')
    expect(envelope.error.code.length).toBeGreaterThan(0)
  })

  it('JSON error 包含 message 字段，且为非空字符串 [P0]', async () => {
    mock.setScenario('auth-expired')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const envelope = toEnvelope(err)
    expect(typeof envelope.error.message).toBe('string')
    expect(envelope.error.message.length).toBeGreaterThan(0)
  })

  it('JSON error 有 hint 时 envelope 包含 hint 字段 [P0]', async () => {
    mock.setScenario('auth-expired')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const envelope = toEnvelope(err)
    if (err.hint !== undefined)
      expect(envelope.error.hint).toBe(err.hint)
  })

  it('JSON error schema 稳定：多次同场景错误的 envelope schema 一致 [P1]', async () => {
    const getSchema = async () => {
      mock.setScenario('server-5xx')
      const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
      return Object.keys(toEnvelope(err).error).sort()
    }
    const schema1 = await getSchema()
    const schema2 = await getSchema()
    expect(schema1).toEqual(schema2)
  })

  it('renderEnvelope 输出为合法单行 JSON [P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const json = renderEnvelope(err)
    expect(() => JSON.parse(json)).not.toThrow()
    expect(json).not.toContain('\n')
  })

  // ── formatErrorForCli ─────────────────────────────────────────────────────

  it('JSON 模式 formatErrorForCli 输出合法 JSON error envelope [P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const out = formatErrorForCli(err, { format: 'json' })
    const parsed = JSON.parse(out) as { error: { code: string, message: string } }
    expect(parsed.error.code).toBe(err.code)
    expect(parsed.error.message).toBe(err.message)
  })

  it('JSON 模式 formatErrorForCli 输出不含 ANSI color [P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const out = formatErrorForCli(err, { format: 'json', isErrTTY: true })
    expect(hasAnsi(out)).toBe(false)
  })

  it('非 TTY 环境（isErrTTY=false）humanError 输出不含 ANSI [P0]', async () => {
    const err = new BaseError({ code: ErrorCode.Server5xx, message: 'boom', hint: 'check server' })
    const out = formatErrorForCli(err, { isErrTTY: false })
    expect(hasAnsi(out)).toBe(false)
  })

  it('human error 输出包含 code 和 message（格式 code: message）[P0]', async () => {
    const err = new BaseError({ code: ErrorCode.Server5xx, message: 'server error' })
    const out = formatErrorForCli(err, { isErrTTY: false })
    expect(out).toContain('server_5xx')
    expect(out).toContain('server error')
  })

  it('human error 有 hint 时输出包含 hint [P0]', async () => {
    const err = new BaseError({
      code: ErrorCode.AuthExpired,
      message: 'session expired',
      hint: 'run difyctl auth login',
    })
    const out = formatErrorForCli(err, { isErrTTY: false })
    expect(out).toContain('run difyctl auth login')
  })

  it('普通模式不显示 stack trace（humanError 无 at … 格式）[P0]', async () => {
    const err = new BaseError({ code: ErrorCode.Unknown, message: 'boom' })
    const out = formatErrorForCli(err, { isErrTTY: false })
    expect(out).not.toMatch(/at\s+\S+\.js:\d+/)
    expect(out).not.toContain('Error: ')
  })

  // ── 敏感信息不泄露 ────────────────────────────────────────────────────────

  it('redactBearer 将 Bearer token 替换为 [redacted] [P0]', () => {
    const input = 'Authorization: Bearer dfoa_abc123 — request to /api'
    const out = redactBearer(input)
    expect(out).not.toContain('dfoa_abc123')
    expect(out).toContain('[redacted]')
  })

  it('redactBearer 对 dfoe_ 类型 token 同样脱敏 [P0]', () => {
    const input = 'Bearer dfoe_xyz789'
    const out = redactBearer(input)
    expect(out).not.toContain('dfoe_xyz789')
    expect(out).toContain('[redacted]')
  })

  it('server 500 错误的 url 已脱敏（不含原始 Bearer token）[P0]', async () => {
    mock.setScenario('server-5xx')
    const err = await captureError(() => runGetApp({}, { bundle: baseBundle, http: http() }))
    const envelope = JSON.stringify(toEnvelope(err))
    expect(envelope).not.toMatch(/dfoa_[a-z0-9]+/i)
    expect(envelope).not.toMatch(/dfoe_[a-z0-9]+/i)
  })

  // ── stderr/stdout 流隔离 ──────────────────────────────────────────────────

  it('stderr 输出不污染 stdout（失败命令 outBuf 为空）[P0]', async () => {
    mock.setScenario('server-5xx')
    const io = bufferStreams()
    try {
      await runApp({ appId: 'app-1', message: 'hi' }, { bundle: baseBundle, http: http(), host: mock.url, io })
    }
    catch { /* expected */ }
    expect(io.outBuf()).toBe('')
  })

  it('成功 run app stdout 有内容，errBuf 无 "error" [P1]', async () => {
    const c = await cache()
    const io = bufferStreams()
    await runApp({ appId: 'app-1', message: 'test' }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c })
    expect(io.outBuf()).toContain('echo:')
    expect(io.errBuf().toLowerCase()).not.toContain('error:')
  })

  // ── Unicode / 中文错误消息 ─────────────────────────────────────────────────

  it('中文路径错误消息 Unicode 正常显示（不转义为 \\uXXXX）[P1]', async () => {
    const c = await cache()
    const io = bufferStreams()
    const chinesePath = join(dir, '中文文件.txt')
    const err = await captureError(() =>
      runApp({ appId: 'app-2', files: [`doc=@${chinesePath}`] }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: c }),
    )
    // 错误消息应含中文原文，而非 \u8f93 之类转义
    expect(err.message).toContain('中文文件.txt')
  })

  // ── 已知缺陷标注（作为文档/追踪用，不要求 pass）──────────────────────────

  it('server 4xx 在 -o json 模式下 exit code 为 1（Generic）[P0]', async () => {
    const { run } = await import('../../../src/framework/run.js')
    const { Command } = await import('../../../src/framework/command.js')
    const { Flags } = await import('../../../src/framework/flags.js')
    const { BaseError } = await import('../../../src/errors/base.js')
    const { ErrorCode } = await import('../../../src/errors/codes.js')

    class Boom extends Command {
      static override flags = {
        output: Flags.string({ char: 'o', description: 'fmt', default: '' }),
      }

      async run(argv: string[]) {
        this.parse(Boom, argv)
        throw new BaseError({ code: ErrorCode.Server4xxOther, message: 'not found', httpStatus: 404 })
      }
    }

    const tree = { boom: { command: Boom, subcommands: {} } }

    let exitCode: number | undefined
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code
      throw new Error('exited')
    }) as never)
    const errChunks: string[] = []
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      errChunks.push(String(chunk))
      return true
    }) as never)
    try {
      await run(tree, ['boom', '-o', 'json'])
      expect.fail('should exit')
    }
    catch (e) {
      expect(String(e)).toContain('exited')
    }
    finally {
      exitSpy.mockRestore()
      errSpy.mockRestore()
    }
    expect(exitCode).toBe(1)
    const out = errChunks.join('')
    expect(() => JSON.parse(out)).not.toThrow()
    const parsed = JSON.parse(out) as { error: { code: string } }
    expect(parsed.error.code).toBe(ErrorCode.Server4xxOther)
  })

  it('hosts.yml YAML 解析失败时 -o json 输出 JSON envelope（非裸 YAML 错误）[P1]', async () => {
    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { HOSTS_FILE_NAME } = await import('../../../src/auth/hosts.js')
    const { commandTree } = await import('../../../src/commands/tree.js')
    const { run } = await import('../../../src/framework/run.js')

    const prev = process.env.DIFY_CONFIG_DIR
    process.env.DIFY_CONFIG_DIR = dir
    await writeFile(join(dir, HOSTS_FILE_NAME), 'current_host: [\n')

    let exitCode: number | undefined
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code
      throw new Error('exited')
    }) as never)
    const errChunks: string[] = []
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      errChunks.push(String(chunk))
      return true
    }) as never)
    try {
      await run(commandTree, ['get', 'app', '-o', 'json'])
      expect.fail('should exit')
    }
    catch (e) {
      expect(String(e)).toContain('exited')
    }
    finally {
      exitSpy.mockRestore()
      errSpy.mockRestore()
      process.env.DIFY_CONFIG_DIR = prev
    }
    expect(exitCode).toBe(1)
    const stderr = errChunks.join('')
    expect(() => JSON.parse(stderr)).not.toThrow()
    const parsed = JSON.parse(stderr) as { error: { code: string, message: string } }
    expect(parsed.error.code).toBe(ErrorCode.Unknown)
    expect(parsed.error.message.length).toBeGreaterThan(0)
  })

  it('未捕获 TypeError 在 -o json 模式输出 JSON envelope（非裸 TypeError）[P1]', async () => {
    const { run } = await import('../../../src/framework/run.js')
    const { Command } = await import('../../../src/framework/command.js')
    const { Flags } = await import('../../../src/framework/flags.js')

    class TypeBoom extends Command {
      static override flags = {
        output: Flags.string({ char: 'o', description: 'fmt', default: '' }),
      }

      async run(argv: string[]) {
        this.parse(TypeBoom, argv)
        throw new TypeError('boom')
      }
    }

    const tree = { typeboom: { command: TypeBoom, subcommands: {} } }

    let exitCode: number | undefined
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code
      throw new Error('exited')
    }) as never)
    const errChunks: string[] = []
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      errChunks.push(String(chunk))
      return true
    }) as never)
    try {
      await run(tree, ['typeboom', '-o', 'json'])
      expect.fail('should exit')
    }
    catch (e) {
      expect(String(e)).toContain('exited')
    }
    finally {
      exitSpy.mockRestore()
      errSpy.mockRestore()
    }

    expect(exitCode).toBe(1)
    const stderr = errChunks.join('')
    expect(() => JSON.parse(stderr)).not.toThrow()
    const parsed = JSON.parse(stderr) as { error: { code: string, message: string } }
    expect(parsed.error.code).toBe(ErrorCode.Unknown)
    expect(parsed.error.message.length).toBeGreaterThan(0)
    expect(stderr).not.toContain('TypeError')
  })
})
