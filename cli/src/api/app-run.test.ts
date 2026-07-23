import type { DifyMock } from '@test/fixtures/dify-mock/server'
import { startMock } from '@test/fixtures/dify-mock/server'
import { testHttpClient } from '@test/fixtures/http-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppRunClient, buildRunBody } from './app-run.js'

describe('buildRunBody', () => {
  it('does not include response_mode', () => {
    expect('response_mode' in buildRunBody({})).toBe(false)
  })

  it('omits query when message empty', () => {
    expect('query' in buildRunBody({})).toBe(false)
  })

  it('maps message → query', () => {
    expect(buildRunBody({ message: 'hi' }).query).toBe('hi')
  })

  it('passes through inputs', () => {
    const body = buildRunBody({ inputs: { a: '1', b: 42 } })
    expect(body.inputs).toEqual({ a: '1', b: 42 })
  })

  it('omits conversation_id when missing/empty', () => {
    expect('conversation_id' in buildRunBody({ conversationId: '' })).toBe(false)
  })

  it('includes workspace_id when set', () => {
    expect(buildRunBody({ workspaceId: 'ws-1' }).workspace_id).toBe('ws-1')
  })

  it('includes workflow_id when workflowId provided', () => {
    expect(buildRunBody({ workflowId: 'wf-abc' }).workflow_id).toBe('wf-abc')
  })

  it('omits workflow_id when workflowId empty', () => {
    expect('workflow_id' in buildRunBody({ workflowId: '' })).toBe(false)
  })

  it('includes files when provided and non-empty', () => {
    const files = [{ type: 'image', url: 'http://example.com/img.png' }]
    expect(buildRunBody({ files }).files).toEqual(files)
  })

  it('omits files when empty array', () => {
    expect('files' in buildRunBody({ files: [] })).toBe(false)
  })
})

describe('AppRunClient.runStream', () => {
  let mock: DifyMock
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('yields events for chat app', async () => {
    const c = new AppRunClient(testHttpClient(mock.url, 'dfoa_test'))
    const iter = await c.runStream('app-1', buildRunBody({ message: 'hi' }))
    const dec = new TextDecoder()
    const names: string[] = []
    const datas: string[] = []
    for await (const ev of iter) {
      names.push(ev.name)
      datas.push(dec.decode(ev.data))
    }
    expect(names).toEqual(['message', 'message', 'message_end'])
    expect(datas[0]).toContain('"answer":"echo: "')
    expect(datas[1]).toContain('"answer":"hi"')
  })

  it('throws typed BaseError on non-2xx open', async () => {
    mock.setScenario('server-5xx')
    const c = new AppRunClient(testHttpClient(mock.url, { bearer: 'dfoa_test', retryAttempts: 0 }))
    await expect(c.runStream('app-1', buildRunBody({ message: 'hi' }))).rejects.toMatchObject({
      code: 'server_5xx',
    })
  })

  it('aborts when signal fires', async () => {
    expect.assertions(1)
    const c = new AppRunClient(testHttpClient(mock.url, 'dfoa_test'))
    const ctrl = new AbortController()
    const iter = await c.runStream('app-1', buildRunBody({ message: 'hi' }), {
      signal: ctrl.signal,
    })
    ctrl.abort()
    try {
      for await (const _ of iter) {
        /* drain */
      }
    } catch (e) {
      expect((e as Error).name).toBe('AbortError')
    }
  })

  it('derives event name from JSON event field when SSE event line absent', async () => {
    const c = new AppRunClient(testHttpClient(mock.url, 'dfoa_test'))
    const iter = await c.runStream('app-2', buildRunBody({ inputs: { x: '1' } }))
    const names: string[] = []
    for await (const ev of iter) names.push(ev.name)
    expect(names).toEqual([
      'workflow_started',
      'node_started',
      'node_finished',
      'workflow_finished',
    ])
  })
})

describe('AppRunClient.stopTask', () => {
  let mock: DifyMock
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('resolves without error for known app and task', async () => {
    const c = new AppRunClient(testHttpClient(mock.url, 'dfoa_test'))
    await expect(c.stopTask('app-1', 'task-42')).resolves.toBeUndefined()
  })
})

describe('AppRunClient.submitHumanInput', () => {
  let mock: DifyMock
  beforeEach(async () => {
    mock = await startMock({ scenario: 'happy' })
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('resolves without error', async () => {
    const c = new AppRunClient(testHttpClient(mock.url, 'dfoa_test'))
    await expect(
      c.submitHumanInput('app-1', 'tok-abc', 'approve', { comment: 'looks good' }),
    ).resolves.toBeUndefined()
  })
})
