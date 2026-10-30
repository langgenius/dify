import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createHttpClient, createHttpClientWithSpies } from '../../tests/test-utils'
import { CompletionClient } from './completion'

describe('CompletionClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe.each(['blocking', 'streaming'] as const)('object requests in %s mode', (mode) => {
    it.each([
      ['omitted', {}, {}],
      ['undefined', { inputs: undefined }, {}],
      ['provided', { inputs: { topic: 'science' } }, { topic: 'science' }],
    ] as const)(
      'sends an inputs object when inputs are %s',
      async (_case, fields, expectedInputs) => {
        const { client, fetchMock } = createHttpClient()
        fetchMock.mockResolvedValueOnce(
          new Response(mode === 'streaming' ? 'data: {"answer":"ok"}\n\n' : '{"answer":"ok"}', {
            status: 200,
          }),
        )
        const completion = new CompletionClient(client)
        const request = Object.freeze({ ...fields, user: 'user', response_mode: mode })

        const result = await completion.createCompletionMessage(request)

        if ('toText' in result) {
          expect(await result.toText()).toBe('ok')
        } else {
          expect(result.data).toEqual({ answer: 'ok' })
        }
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/completion-messages')
        expect(JSON.parse(init.body as string)).toEqual({
          user: 'user',
          response_mode: mode,
          inputs: expectedInputs,
        })
      },
    )
  })

  it('creates completion messages in blocking mode', async () => {
    const { client, request } = createHttpClientWithSpies()
    const completion = new CompletionClient(client)

    await completion.createCompletionMessage({ input: 'x' }, 'user', false)

    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/completion-messages',
      data: {
        inputs: { input: 'x' },
        user: 'user',
        files: undefined,
        response_mode: 'blocking',
      },
    })
  })

  it('creates completion messages in streaming mode', async () => {
    const { client, requestStream } = createHttpClientWithSpies()
    const completion = new CompletionClient(client)

    await completion.createCompletionMessage({
      inputs: { input: 'x' },
      user: 'user',
      response_mode: 'streaming',
    })

    expect(requestStream).toHaveBeenCalledWith({
      method: 'POST',
      path: '/completion-messages',
      data: {
        inputs: { input: 'x' },
        user: 'user',
        response_mode: 'streaming',
      },
    })
  })

  it('stops completion messages', async () => {
    const { client, request } = createHttpClientWithSpies()
    const completion = new CompletionClient(client)

    await completion.stopCompletionMessage('task', 'user')
    await completion.stop('task', 'user')

    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/completion-messages/task/stop',
      data: { user: 'user' },
    })
  })

  it('supports deprecated runWorkflow', async () => {
    const { client, request, requestStream } = createHttpClientWithSpies()
    const completion = new CompletionClient(client)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await completion.runWorkflow({ input: 'x' }, 'user', false)
    await completion.runWorkflow({ input: 'x' }, 'user', true)

    expect(warn).toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflows/run',
      data: { inputs: { input: 'x' }, user: 'user', response_mode: 'blocking' },
    })
    expect(requestStream).toHaveBeenCalledWith({
      method: 'POST',
      path: '/workflows/run',
      data: { inputs: { input: 'x' }, user: 'user', response_mode: 'streaming' },
    })
  })
})
