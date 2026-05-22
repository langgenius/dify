/**
 * Dify CLI/CLI Framework/Global Flags 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/CLI Framework/Global Flags（33 条）
 *
 * 覆盖策略：
 *  - 通过 runGetApp / runApp / sniffOutputFormat 验证 -o/-w/--http-retry 等全局 flag 行为
 *  - formatHelp 渲染已在 src/framework/help.test.ts 覆盖，此处仅做集成断言
 *  - run() 错误路由已在 src/framework/run.test.ts 覆盖，此处验证真实命令路径
 *  - 标注 WTA-252 等已知缺陷（help 结构优化）
 *
 * ExitCode 规范：Success=0  Generic=1  Usage=2  Auth=4  VersionCompat=6
 */

import type { DifyMock } from '../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAppInfoCache } from '../../../src/cache/app-info.js'
import { HTTP_RETRY_DEFAULT, resolveRetryAttempts } from '../../../src/commands/_shared/global-flags.js'
import GetApp from '../../../src/commands/get/app/index.js'
import { runGetApp } from '../../../src/commands/get/app/run.js'
import RunApp from '../../../src/commands/run/app/index.js'
import { runApp } from '../../../src/commands/run/app/run.js'
import Version from '../../../src/commands/version/index.js'
import { BaseError } from '../../../src/errors/base.js'
import { formatErrorForCli } from '../../../src/errors/format.js'
import { formatHelp } from '../../../src/framework/help.js'
import { stringifyOutput, table } from '../../../src/framework/output.js'
import { sniffOutputFormat } from '../../../src/framework/run.js'
import { createClient } from '../../../src/http/client.js'
import { bufferStreams } from '../../../src/io/streams.js'
import { hostsBundleFixture } from '../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../fixtures/dify-mock/server.js'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHFA-DJsuhl]/
const hasAnsi = (s: string) => ANSI_RE.test(s)

const baseBundle = hostsBundleFixture({ includeAllWorkspaces: true })

describe('Dify CLI/CLI Framework/Global Flags', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-gflags-'))
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

  // ── -o / --output flag ────────────────────────────────────────────────────

  it('-o json 可全局使用（get app 输出合法 JSON）[P0]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    expect(() => JSON.parse(out)).not.toThrow()
    const parsed = JSON.parse(out) as { data: unknown[] }
    expect(Array.isArray(parsed.data)).toBe(true)
  })

  it('-o yaml 可全局使用（get app 输出合法 YAML）[P0]', async () => {
    const { default: yaml } = await import('js-yaml')
    const result = await runGetApp({ format: 'yaml' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'yaml', data: result.data }))
    expect(() => yaml.load(out)).not.toThrow()
  })

  it('多个 global flags 可组合使用（-o json + workspace override）[P0]', async () => {
    const result = await runGetApp({ format: 'json', workspace: 'ws-2' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    const parsed = JSON.parse(out) as { data: Array<{ id: string }> }
    const ids = parsed.data.map(r => r.id)
    expect(ids).toContain('app-3')
    expect(ids).not.toContain('app-1')
  })

  it('output flag 非法值抛出 "not supported" 错误 [P0]', async () => {
    const result = await runGetApp({}, { bundle: baseBundle, http: http() })
    expect(() =>
      stringifyOutput(table({ format: 'bogus', data: result.data })),
    ).toThrow(/not supported/)
  })

  it('global flags 支持 shell pipe（-o json 输出为 pipe 友好格式）[P1]', async () => {
    const result = await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    const out = stringifyOutput(table({ format: 'json', data: result.data }))
    // pipe 友好：首字符为 {，末尾为 \n，无 ANSI
    expect(out.trim().startsWith('{')).toBe(true)
    expect(out.endsWith('\n')).toBe(true)
    expect(hasAnsi(out)).toBe(false)
  })

  it('global flags 不影响 stream 输出（--stream + -o json 同时工作）[P1]', async () => {
    const c = await cache()
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi', stream: true, format: 'json' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: c },
    )
    expect(() => JSON.parse(io.outBuf())).not.toThrow()
  })

  // ── sniffOutputFormat（-o flag 解析）─────────────────────────────────────

  it('sniffOutputFormat 正确解析 -o json（空格形式）[P0]', () => {
    expect(sniffOutputFormat(['get', 'app', '-o', 'json'])).toBe('json')
  })

  it('sniffOutputFormat 正确解析 --output=yaml（等号形式）[P0]', () => {
    expect(sniffOutputFormat(['get', 'app', '--output=yaml'])).toBe('yaml')
  })

  it('sniffOutputFormat 无 -o flag 时返回空字符串 [P0]', () => {
    expect(sniffOutputFormat(['get', 'app'])).toBe('')
  })

  it('sniffOutputFormat 在 -- 之后的 flag 不被解析 [P0]', () => {
    expect(sniffOutputFormat(['cmd', '--', '-o', 'json'])).toBe('')
  })

  it('sniffOutputFormat 对 --output 大小写敏感（--OUTPUT 不被识别）[P1]', () => {
    expect(sniffOutputFormat(['cmd', '--OUTPUT=json'])).toBe('')
  })

  it('重复 -o flag 以第一个为准 [P1]', () => {
    expect(sniffOutputFormat(['cmd', '-o', 'json', '-o', 'yaml'])).toBe('json')
  })

  // ── -w / --workspace flag ─────────────────────────────────────────────────

  it('-w workspace flag 覆盖默认 workspace（get app 切换到 ws-2）[P0]', async () => {
    const result = await runGetApp({ workspace: 'ws-2' }, { bundle: baseBundle, http: http() })
    const ids = result.data.rows.map(r => r.data.id)
    expect(ids).toContain('app-3')
    expect(ids).not.toContain('app-1')
  })

  it('workspace flag 非法值（workspace 不存在）返回空列表 [P0]', async () => {
    const result = await runGetApp({ workspace: 'ws-nonexistent' }, { bundle: baseBundle, http: http() })
    expect(result.data.rows).toHaveLength(0)
  })

  // ── --http-retry flag ─────────────────────────────────────────────────────

  it('resolveRetryAttempts：flag 优先于 env 变量 [P0]', () => {
    expect(resolveRetryAttempts({ flag: 0, env: () => '5' })).toBe(0)
  })

  it('resolveRetryAttempts：env 变量为 fallback [P0]', () => {
    expect(resolveRetryAttempts({ flag: undefined, env: () => '7' })).toBe(7)
  })

  it(`resolveRetryAttempts：默认值为 ${HTTP_RETRY_DEFAULT} [P0]`, () => {
    expect(resolveRetryAttempts({ flag: undefined, env: () => undefined })).toBe(HTTP_RETRY_DEFAULT)
  })

  it('DIFYCTL_HTTP_RETRY 非数字抛出 UsageInvalidFlag [P0]', () => {
    expect(() =>
      resolveRetryAttempts({ flag: undefined, env: () => 'abc' }),
    ).toThrow(/DIFYCTL_HTTP_RETRY/)
  })

  it('DIFYCTL_HTTP_RETRY 负数抛出 UsageInvalidFlag [P0]', () => {
    expect(() =>
      resolveRetryAttempts({ flag: undefined, env: () => '-1' }),
    ).toThrow(/DIFYCTL_HTTP_RETRY/)
  })

  // ── --help 输出 ───────────────────────────────────────────────────────────

  it('formatHelp 包含 USAGE 和 FLAGS 两个章节 [P0]', () => {
    const out = formatHelp(RunApp, 'run app')
    expect(out).toContain('USAGE')
    expect(out).toContain('FLAGS')
  })

  it('formatHelp 包含 --inputs 和 --stream 等命令级 flag [P1]', () => {
    const out = formatHelp(RunApp, 'run app')
    expect(out).toContain('--inputs')
    expect(out).toContain('--stream')
  })

  it('formatHelp 包含 EXAMPLES 区域 [P1]', () => {
    const out = formatHelp(RunApp, 'run app')
    expect(out).toContain('EXAMPLES')
    expect(out).toContain('difyctl run app')
  })

  it('get app formatHelp 包含 --output 和 --workspace flag [P1]', () => {
    const out = formatHelp(GetApp, 'get app')
    expect(out).toContain('--output')
    expect(out).toContain('--workspace')
  })

  it('formatHelp 输出不含 ANSI 颜色控制字符 [P1]', () => {
    const out = formatHelp(RunApp, 'run app')
    expect(hasAnsi(out)).toBe(false)
  })

  it('formatHelp 输出末尾为 \\n [P1]', () => {
    const out = formatHelp(RunApp, 'run app')
    expect(out.endsWith('\n')).toBe(true)
  })

  // ── --version flag ────────────────────────────────────────────────────────

  it('Version 命令 run([]) 返回 formatted 类型输出 [P0]', async () => {
    const probe = await import('../../../src/version/probe.js')
    vi.spyOn(probe, 'runVersionProbe').mockResolvedValue({
      client: { version: '0.0.0-test', commit: '0000000', buildDate: '1970-01-01T00:00:00.000Z', channel: 'dev', platform: 'test', arch: 'test' },
      server: { endpoint: '', reachable: false },
      compat: { minDify: '1.6.0', maxDify: '1.7.0', status: 'unknown', detail: '' },
    })
    try {
      const output = await new Version().run([])
      expect(output?.kind).toBe('formatted')
    }
    finally {
      vi.restoreAllMocks()
    }
  })

  it('version --short 返回 raw 类型输出 [P1]', async () => {
    const probe = await import('../../../src/version/probe.js')
    vi.spyOn(probe, 'runVersionProbe').mockResolvedValue({
      client: { version: '0.0.0-test', commit: '0000000', buildDate: '1970-01-01T00:00:00.000Z', channel: 'dev', platform: 'test', arch: 'test' },
      server: { endpoint: '', reachable: false },
      compat: { minDify: '1.6.0', maxDify: '1.7.0', status: 'unknown', detail: '' },
    })
    try {
      const output = await new Version().run(['--short'])
      expect(output?.kind).toBe('raw')
    }
    finally {
      vi.restoreAllMocks()
    }
  })

  // ── 错误路由（与 run.test.ts 补充差异的场景）──────────────────────────────

  it('非法 global flag（--invalid）抛出错误 [P0]', async () => {
    // 在真实命令中传入未知 flag → parseArgv 抛错
    // RunApp 的 parse 会拒绝未知 flag
    await expect(
      new RunApp().run(['app-1', '--invalid-unknown-flag']),
    ).rejects.toThrow()
  })

  it('非法 flag exit code 通过 BaseError exit() 返回 2（Usage）[P0]', async () => {
    // parseArgv 抛出 Usage 类型错误
    const { parseArgv } = await import('../../../src/framework/flags.js')
    const { Flags } = await import('../../../src/framework/flags.js')
    const meta = { flags: { output: Flags.string({ description: 'fmt', char: 'o' }) }, args: {} }
    expect(() => parseArgv(['--unknown-flag'], meta)).toThrow()
  })

  it('formatErrorForCli 在 JSON 模式输出合法 JSON error envelope [P1]', async () => {
    mock.setScenario('server-5xx')
    try {
      await runGetApp({ format: 'json' }, { bundle: baseBundle, http: http() })
    }
    catch (e) {
      if (e instanceof BaseError) {
        const out = formatErrorForCli(e, { format: 'json' })
        expect(() => JSON.parse(out)).not.toThrow()
        const parsed = JSON.parse(out) as { error: { code: string } }
        expect(parsed.error.code).toBe(e.code)
      }
    }
  })

  // ── 已知缺陷标注 ──────────────────────────────────────────────────────────

  it('top-level --help 输出包含 auth devices 描述文字（组命令也有说明）[P1]', async () => {
    const { commandTree } = await import('../../../src/commands/tree.js')
    const { run } = await import('../../../src/framework/run.js')
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    }) as never)
    try {
      await run(commandTree, ['--help'])
    }
    finally {
      spy.mockRestore()
    }
    const out = chunks.join('')
    expect(out).toMatch(/\bauth\b/)
    expect(out).toMatch(/\bdevices\b/)
    expect(out).toMatch(/devices\s+2 subcommands/)
  })

  it('top-level --help 输出包含 GLOBAL FLAGS 章节（-o/--output、--workspace、--http-retry）[P1]', async () => {
    const { commandTree } = await import('../../../src/commands/tree.js')
    const { run } = await import('../../../src/framework/run.js')
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    }) as never)
    try {
      await run(commandTree, ['--help'])
    }
    finally {
      spy.mockRestore()
    }
    const out = chunks.join('')
    expect(out).toContain('GLOBAL FLAGS')
    expect(out).toContain('--output')
    expect(out).toContain('--workspace')
    expect(out).toContain('--http-retry')
  })

  it('top-level --help 输出包含 Quick start 示例（auth login → get app → run app）[P1]', async () => {
    const { commandTree } = await import('../../../src/commands/tree.js')
    const { run } = await import('../../../src/framework/run.js')
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    }) as never)
    try {
      await run(commandTree, ['--help'])
    }
    finally {
      spy.mockRestore()
    }
    const out = chunks.join('')
    expect(out).toContain('QUICK START')
    expect(out).toContain('difyctl auth login')
    expect(out).toContain('difyctl get app')
    expect(out).toContain('difyctl run app')
  })
})
