/**
 * Dify CLI/Run/文件输入 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/文件输入（31 条）
 * 注：解析层（parseFileFlag / difyFileType / resolveFileInputs）已在
 *     src/commands/run/app/file-flags.test.ts 中覆盖。
 *     本文件专注于与 mock server 配合的 end-to-end 集成路径。
 */

import type { DifyMock } from '../../../../fixtures/dify-mock/server.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadAppInfoCache } from '../../../../../src/cache/app-info.js'
import { runApp } from '../../../../../src/commands/run/app/run.js'
import { createClient } from '../../../../../src/http/client.js'
import { bufferStreams } from '../../../../../src/io/streams.js'
import { hostsBundleFixture } from '../../../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../../../fixtures/dify-mock/server.js'

const baseBundle = hostsBundleFixture()

describe('Dify CLI/Run/文件输入', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-file-input-'))
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

  // ── 本地文件上传 ──────────────────────────────────────────────────────────

  it('run app 支持单文件上传（key=@path），upload endpoint 被调用 [P0]', async () => {
    const filePath = join(dir, 'demo.txt')
    await writeFile(filePath, 'hello')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`doc=@${filePath}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.uploadCallCount).toBe(1)
  })

  it('上传成功后 file_id 传递给 execute API（lastRunBody 含 upload_file_id）[P0]', async () => {
    const filePath = join(dir, 'report.pdf')
    await writeFile(filePath, 'fake pdf')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`doc=@${filePath}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, Record<string, unknown>>
    expect(inputs?.doc?.transfer_method).toBe('local_file')
    expect(inputs?.doc?.upload_file_id).toBe('upload-file-1')
  })

  it('file input 参数名正确映射（key 与 varname 一致）[P0]', async () => {
    const filePath = join(dir, 'img.png')
    await writeFile(filePath, 'fake png')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`mykey=@${filePath}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.mykey).toBeDefined()
  })

  it('上传文件后 app 正常执行，stdout 有输出 [P0]', async () => {
    const filePath = join(dir, 'test.txt')
    await writeFile(filePath, 'content')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`doc=@${filePath}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().length).toBeGreaterThan(0)
  })

  it('支持多个文件同时上传 [P0]', async () => {
    const file1 = join(dir, 'a.txt')
    const file2 = join(dir, 'b.pdf')
    await writeFile(file1, 'aaa')
    await writeFile(file2, 'bbb')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`f1=@${file1}`, `f2=@${file2}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.uploadCallCount).toBe(2)
  })

  it('--file 覆盖同名 --inputs 中的 key（文件优先）[P0]', async () => {
    const filePath = join(dir, 'override.pdf')
    await writeFile(filePath, 'override')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: { doc: 'old-value' }, files: [`doc=@${filePath}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, Record<string, unknown>>
    expect(inputs?.doc?.transfer_method).toBe('local_file')
  })

  // ── 远程 URL ──────────────────────────────────────────────────────────────

  it('--file 远程 URL 语法（key=https://...），不调用 upload endpoint [P0]', async () => {
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: ['doc=https://example.com/report.pdf'] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.uploadCallCount).toBe(0)
    const inputs = mock.lastRunBody?.inputs as Record<string, Record<string, unknown>>
    expect(inputs?.doc?.transfer_method).toBe('remote_url')
    expect(inputs?.doc?.url).toBe('https://example.com/report.pdf')
  })

  it('run app --file 语法为 key=@path（本地）[P0]', async () => {
    const filePath = join(dir, 'file.txt')
    await writeFile(filePath, 'data')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`key=@${filePath}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, Record<string, unknown>>
    expect(inputs?.key?.transfer_method).toBe('local_file')
  })

  // ── 格式支持 ──────────────────────────────────────────────────────────────

  it('支持 txt 文件上传 [P1]', async () => {
    const f = join(dir, 'note.txt')
    await writeFile(f, 'text')
    const io = bufferStreams()
    await runApp({ appId: 'app-2', files: [`doc=@${f}`] }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() })
    expect(mock.uploadCallCount).toBe(1)
  })

  it('支持 pdf 文件上传 [P1]', async () => {
    const f = join(dir, 'report.pdf')
    await writeFile(f, 'pdf-content')
    const io = bufferStreams()
    await runApp({ appId: 'app-2', files: [`doc=@${f}`] }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() })
    expect(mock.uploadCallCount).toBe(1)
  })

  it('支持 image 文件上传（png）[P1]', async () => {
    const f = join(dir, 'photo.png')
    await writeFile(f, 'fake-png')
    const io = bufferStreams()
    await runApp({ appId: 'app-2', files: [`img=@${f}`] }, { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() })
    const inputs = mock.lastRunBody?.inputs as Record<string, Record<string, unknown>>
    expect(inputs?.img?.type).toBe('image')
  })

  it('同时上传文件与普通 input，两类参数全部生效 [P1]', async () => {
    const f = join(dir, 'mix.txt')
    await writeFile(f, 'data')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', inputs: { x: 'val' }, files: [`doc=@${f}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    const inputs = mock.lastRunBody?.inputs as Record<string, unknown>
    expect(inputs?.x).toBe('val')
    expect(inputs?.doc).toBeDefined()
  })

  it('--file 与 --stream 组合使用，streaming 正常输出 [P1]', async () => {
    const f = join(dir, 'stream.txt')
    await writeFile(f, 'stream-data')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`doc=@${f}`], stream: true },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(io.outBuf().length).toBeGreaterThan(0)
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('文件不存在时返回 upload failed 错误 [P0]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', files: ['doc=@/nonexistent/path/file.txt'] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )).rejects.toThrow()
  })

  it('file 参数格式错误（无 = 分隔符）返回 usage error [P1]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', files: ['invalidflag'] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )).rejects.toThrow(/--file must be key=@path/)
  })

  it('file value 不是 @ 或 http(s):// 时返回 usage error [P1]', async () => {
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', files: ['doc=plainstring'] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )).rejects.toThrow(/--file value must start with @/)
  })

  it('未登录执行 file upload 返回认证错误（exit code 4）[P0]', async () => {
    mock.setScenario('auth-expired')
    const f = join(dir, 'auth.txt')
    await writeFile(f, 'data')
    const io = bufferStreams()
    const { BaseError } = await import('../../../../../src/errors/base.js')
    try {
      await runApp(
        { appId: 'app-2', files: [`doc=@${f}`] },
        { bundle: baseBundle, http: http(), host: mock.url, io },
      )
      expect.fail('should throw')
    }
    catch (e) {
      expect(e instanceof BaseError).toBe(true)
      expect((e as InstanceType<typeof BaseError>).exit()).toBe(4)
    }
  })

  it('upload endpoint 返回 500 时失败 [P0]', async () => {
    mock.setScenario('server-5xx')
    const f = join(dir, 'serverdown.txt')
    await writeFile(f, 'data')
    const io = bufferStreams()
    await expect(runApp(
      { appId: 'app-2', files: [`doc=@${f}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io },
    )).rejects.toThrow()
  })

  it('文件路径包含空格可正常上传 [P1]', async () => {
    const f = join(dir, 'my file.txt')
    await writeFile(f, 'space-in-name')
    const io = bufferStreams()
    await runApp(
      { appId: 'app-2', files: [`doc=@${f}`] },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: await cache() },
    )
    expect(mock.uploadCallCount).toBe(1)
  })
})
