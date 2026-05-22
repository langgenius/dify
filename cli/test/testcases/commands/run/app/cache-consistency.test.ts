/**
 * Dify CLI/Run/缓存与版本一致性 集成测试
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/缓存与版本一致性（3 条）
 */

import type { DifyMock } from '../../../../fixtures/dify-mock/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { APP_INFO_TTL_MS, loadAppInfoCache } from '../../../../../src/cache/app-info.js'
import { runDescribeApp } from '../../../../../src/commands/describe/app/run.js'
import { runApp } from '../../../../../src/commands/run/app/run.js'
import { createClient } from '../../../../../src/http/client.js'
import { bufferStreams } from '../../../../../src/io/streams.js'
import { hostsBundleFixture } from '../../../../fixtures/dify-mock/scenarios.js'
import { startMock } from '../../../../fixtures/dify-mock/server.js'

const baseBundle = hostsBundleFixture()

describe('Dify CLI/Run/缓存与版本一致性', () => {
  let mock: DifyMock
  let dir: string

  beforeAll(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  beforeEach(async () => {
    mock.setScenario('happy')
    mock.reset()
    dir = await mkdtemp(join(tmpdir(), 'difyctl-cache-'))
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

  it('APP_INFO_TTL_MS 默认为 1h（3600000ms）[P1]', () => {
    expect(APP_INFO_TTL_MS).toBe(60 * 60 * 1000)
  })

  it('1h 内 run app 使用缓存的 mode（isFresh=true）[P1]', async () => {
    // 首次 run → 缓存写入
    const cache = await loadAppInfoCache({ configDir: dir })
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'first' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache },
    )
    // 缓存应已写入
    const record = cache.get(mock.url, 'app-1')
    if (record === undefined)
      throw new Error('expected cache record to exist')
    expect(cache.isFresh(record)).toBe(true)

    // 二次 run，验证缓存仍有效
    const io2 = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'second' },
      { bundle: baseBundle, http: http(), host: mock.url, io: io2, cache },
    )
    expect(cache.isFresh(record)).toBe(true)
  })

  it('缓存过期（TTL 已到）后 isFresh 返回 false [P1]', async () => {
    // 使用极短 TTL（1ms），使缓存立即过期
    const shortCache = await loadAppInfoCache({ configDir: dir, ttlMs: 1 })
    const io = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'hi' },
      { bundle: baseBundle, http: http(), host: mock.url, io, cache: shortCache },
    )
    const record = shortCache.get(mock.url, 'app-1')
    expect(record).toBeDefined()
    // 等待 2ms 让缓存过期
    await new Promise(r => setTimeout(r, 2))
    expect(shortCache.isFresh(record!)).toBe(false)
  })

  it('删除缓存后 run app 重新 fetch 最新 app 信息 [P0]', async () => {
    // Step 1: 首次运行写入缓存
    const cache = await loadAppInfoCache({ configDir: dir })
    const io1 = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'first' },
      { bundle: baseBundle, http: http(), host: mock.url, io: io1, cache },
    )
    expect(cache.get(mock.url, 'app-1')).toBeDefined()

    // Step 2: 删除缓存条目
    await cache.delete(mock.url, 'app-1')
    expect(cache.get(mock.url, 'app-1')).toBeUndefined()

    // Step 3: 重新 run，应重新 fetch（mock 服务器被调用 describe 接口）
    const io2 = bufferStreams()
    await runApp(
      { appId: 'app-1', message: 'after-delete' },
      { bundle: baseBundle, http: http(), host: mock.url, io: io2, cache },
    )
    // 缓存应已重新写入
    expect(cache.get(mock.url, 'app-1')).toBeDefined()
    expect(io2.outBuf()).toContain('echo:')
  })

  it('describe app --refresh 绕过缓存，重新 fetch 并更新 fetchedAt [P0]', async () => {
    const cache = await loadAppInfoCache({ configDir: dir })

    // 首次 describe → 写入缓存
    await runDescribeApp(
      { appId: 'app-1' },
      { bundle: baseBundle, http: http(), host: mock.url, cache },
    )
    const before = cache.get(mock.url, 'app-1')
    expect(before).toBeDefined()

    // 稍等确保时间戳差异可被检测
    await new Promise(r => setTimeout(r, 5))

    // --refresh → 绕过缓存，重新 fetch
    await runDescribeApp(
      { appId: 'app-1', refresh: true },
      { bundle: baseBundle, http: http(), host: mock.url, cache },
    )
    const after = cache.get(mock.url, 'app-1')
    expect(after).toBeDefined()
    expect(after!.fetchedAt).not.toBe(before!.fetchedAt)
  })
})
