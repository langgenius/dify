import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createHttpClient, createHttpClientWithSpies } from '../../tests/test-utils'
import { WorkflowClient } from './workflow'

describe('WorkflowClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe.each(['blocking', 'streaming'] as const)('object requests in %s mode', (mode) => {
    it.each([
      ['omitted', {}, {}],
      ['undefined', { inputs: undefined }, {}],
      ['provided', { inputs: { topic: 'science' } }, { topic: 'science' }],
    ] as const)(
      'run() sends an inputs object when inputs are %s',
      async (_case, fields, expectedInputs) => {
        const { client, fetchMock } = createHttpClient()
        fetchMock.mockResolvedValueOnce(
          new Response(
            mode === 'streaming' ? 'data: {"event":"workflow_finished"}\n\n' : '{"workflow_run_id":"run-1"}',
            { status: 200 },
          ),
        )
        const workflow = new WorkflowClient(client)
        const request = Object.freeze({
          ...fields,
          user: 'user',
          response_mode: mode,
        })

        const result = await workflow.run(request)

        if (Symbol.asyncIterator in result) {
          const events = []
          for await (const event of result) {
            events.push(event)
          }
          expect(events).toHaveLength(1)
        } else {
          expect(result.data).toEqual({ workflow_run_id: 'run-1' })
        }
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/workflows/run')
        expect(JSON.parse(init.body as string)).toEqual({
          user: 'user',
          response_mode: mode,
          inputs: expectedInputs,
        })
      },
    )

    it.each([
      ['omitted', {}, {}],
      ['undefined', { inputs: undefined }, {}],
      ['provided', { inputs: { topic: 'science' } }, { topic: 'science' }],
    ] as const)(
      'runById() sends an inputs object when inputs are %s',
      async (_case, fields, expectedInputs) => {
        const { client, fetchMock } = createHttpClient()
        fetchMock.mockResolvedValueOnce(
          new Response(
            mode === 'streaming' ? 'data: {"event":"workflow_finished"}\n\n' : '{"workflow_run_id":"run-1"}',
            { status: 200 },
          ),
        )
        const workflow = new WorkflowClient(client)
        const request = Object.freeze({
          ...fields,
          user: 'user',
          response_mode: mode,
        })

        const result = await workflow.runById('wf-1', request)

        if (Symbol.asyncIterator in result) {
          const events = []
          for await (const event of result) {
            events.push(event)
          }
          expect(events).toHaveLength(1)
        } else {
          expect(result.data).toEqual({ workflow_run_id: 'run-1' })
        }
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/workflows/wf-1/run')
        expect(JSON.parse(init.body as string)).toEqual({
          user: 'user',
          response_mode: mode,
          inputs: expectedInputs,
        })
      },
    )
  })

  it('runs workflows with blocking and streaming modes', async () => {
    const { client, request, requestStream } = createHttpClientWithSpies()
    const workflow = new WorkflowClient(client)

    await workflow.run({ inputs: { input: 'x' }, user: 'user' })
    await workflow.run({ input: 'x' }, 'user', true)

    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflows/run',
      data: {
        inputs: { input: 'x' },
        user: 'user',
      },
    })
    expect(requestStream).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflows/run',
      data: {
        inputs: { input: 'x' },
        user: 'user',
        response_mode: 'streaming',
      },
    })
  })

  it('runs workflow by id', async () => {
    const { client, request, requestStream } = createHttpClientWithSpies()
    const workflow = new WorkflowClient(client)

    await workflow.runById('wf', {
      inputs: { input: 'x' },
      user: 'user',
      response_mode: 'blocking',
    })
    await workflow.runById('wf', {
      inputs: { input: 'x' },
      user: 'user',
      response_mode: 'streaming',
    })

    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflows/wf/run',
      data: {
        inputs: { input: 'x' },
        user: 'user',
        response_mode: 'blocking',
      },
    })
    expect(requestStream).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflows/wf/run',
      data: {
        inputs: { input: 'x' },
        user: 'user',
        response_mode: 'streaming',
      },
    })
  })

  it('gets run details and stops workflow', async () => {
    const { client, request } = createHttpClientWithSpies()
    const workflow = new WorkflowClient(client)

    await workflow.getRun('run')
    await workflow.stop('task', 'user')

    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/workflows/run/run',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflows/tasks/task/stop',
      data: { user: 'user' },
    })
  })

  it('fetches workflow logs', async () => {
    const { client, request } = createHttpClientWithSpies()
    const workflow = new WorkflowClient(client)

    await workflow.getLogs({
      keyword: 'k',
      status: 'succeeded',
      startTime: '2024-01-01',
      endTime: '2024-01-02',
      createdByEndUserSessionId: 'session-123',
      page: 1,
      limit: 20,
    })

    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/workflows/logs',
      query: {
        keyword: 'k',
        status: 'succeeded',
        created_at__before: '2024-01-02',
        created_at__after: '2024-01-01',
        created_by_end_user_session_id: 'session-123',
        created_by_account: undefined,
        page: 1,
        limit: 20,
      },
    })
  })
})
