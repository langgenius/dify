import type { StreamCallbacks, StreamRequest, StreamRequestOptions } from '../event-stream'
import { ORPCError } from '@orpc/client'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { consoleClient } from '../console'
import { sendCompletionMessage } from '../debug'
import { streamEvents, streamGeneratorEvents } from '../event-stream'
import { generateWorkflowStream } from '../workflow-generator'

const refreshAccessTokenOrReLoginMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('../refresh-token', () => ({
  refreshAccessTokenOrReLogin: refreshAccessTokenOrReLoginMock,
}))

vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

const encode = (text: string) => new TextEncoder().encode(text)
const frame = (data: Record<string, unknown>) => `data: ${JSON.stringify(data)}\n\n`

const eventStreamResponse = (chunks: (string | Uint8Array)[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(typeof chunk === 'string' ? encode(chunk) : chunk)
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

/** A stream that stays open until the request is aborted. */
const pendingEventStreamResponse = (chunks: string[], signal: AbortSignal) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encode(chunk))
        signal.addEventListener('abort', () => controller.error(signal.reason))
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

async function* framesOf(...frames: unknown[]) {
  for (const item of frames) yield item
}

const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>

const getFetchedRequest = async (index = 0) => {
  const [input, init] = fetchMock().mock.calls[index]! as [RequestInfo | URL, RequestInit?]
  const request = input instanceof Request ? input : new Request(input, init)
  return {
    url: new URL(request.url),
    method: request.method,
    headers: new Headers(init?.headers ?? request.headers),
    body: await request.clone().text(),
    signal: request.signal,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('streamEvents', () => {
  const run = (request: StreamRequest, callbacks: StreamCallbacks) => {
    const onCompleted = vi.fn(callbacks.onCompleted)
    streamEvents(request, { ...callbacks, onCompleted })
    return onCompleted
  }

  it('dispatches frames to their callbacks in order and completes', async () => {
    const calls: string[] = []
    const onData = vi.fn(() => calls.push('data'))
    const onCompleted = run(
      () =>
        Promise.resolve(
          framesOf(
            { event: 'workflow_started', task_id: 'task-1' },
            {
              event: 'message',
              answer: 'Hi \\u4f60',
              id: 'm-1',
              conversation_id: 'c-1',
              task_id: 't-1',
            },
            {
              event: 'agent_message',
              answer: '!',
              id: 'm-1',
              conversation_id: 'c-1',
              task_id: 't-1',
            },
            { event: 'node_finished', data: { id: 'node-1' } },
            { event: 'tts_message', message_id: 'm-1', audio: 'abc', audio_type: 'audio/mpeg' },
            { event: 'tts_message_end', message_id: 'm-1', audio: '' },
            { event: 'message_end', id: 'm-1' },
          ),
        ),
      {
        onData,
        onWorkflowStarted: () => calls.push('workflow_started'),
        onNodeFinished: () => calls.push('node_finished'),
        onTTSChunk: (...args) => calls.push(`tts:${args.join(',')}`),
        onTTSEnd: () => calls.push('tts_end'),
        onMessageEnd: () => calls.push('message_end'),
        onCompleted: () => calls.push('completed'),
      },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())

    expect(calls).toEqual([
      'workflow_started',
      'data',
      'data',
      'node_finished',
      'tts:m-1,abc,audio/mpeg',
      'tts_end',
      'message_end',
      'completed',
    ])
    expect(onData).toHaveBeenNthCalledWith(1, 'Hi 你', true, {
      event: 'message',
      conversationId: 'c-1',
      taskId: 't-1',
      messageId: 'm-1',
    })
    expect(onData).toHaveBeenNthCalledWith(
      2,
      '!',
      false,
      expect.objectContaining({ event: 'agent_message' }),
    )
    expect(onCompleted).toHaveBeenCalledWith()
  })

  it('passes an abort signal and stream context to the request and exposes the controller', async () => {
    const request = vi.fn((_options: StreamRequestOptions) => Promise.resolve(framesOf()))
    let controller: AbortController | undefined
    const onCompleted = run(request, { getAbortController: (c) => (controller = c) })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(controller).toBeInstanceOf(AbortController)
    expect(request).toHaveBeenCalledWith({
      signal: controller!.signal,
      context: { stream: true },
    })
  })

  it('ends the stream on an error frame and reports it once', async () => {
    const onError = vi.fn()
    const onNodeStarted = vi.fn()
    const onCompleted = run(
      () =>
        Promise.resolve(
          framesOf(
            {
              event: 'error',
              message: 'Quota exceeded',
              code: 'quota',
              conversation_id: 'c-1',
              message_id: 'm-1',
            },
            { event: 'node_started' },
          ),
        ),
      { onError, onNodeStarted },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(onError).toHaveBeenCalledWith('Quota exceeded', 'quota', {
      conversationId: 'c-1',
      messageId: 'm-1',
      errorMessage: 'Quota exceeded',
      errorCode: 'quota',
    })
    expect(toast.error).toHaveBeenCalledWith('Quota exceeded')
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true, 'Quota exceeded')
    expect(onNodeStarted).not.toHaveBeenCalled()
  })

  it('treats error statuses and frames without an event as errors', async () => {
    const onNotifyError = vi.fn()
    const onCompleted = run(() => Promise.resolve(framesOf({ status: 500, message: 'Boom' })), {
      onNotifyError,
    })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(true, 'Boom'))
    expect(onNotifyError).toHaveBeenCalledWith('Boom', undefined)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports non-object frames as invalid data', async () => {
    const onError = vi.fn()
    const onCompleted = run(() => Promise.resolve(framesOf('oops')), {
      onError,
      onNotifyError: vi.fn(),
    })

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(true, 'Invalid response data'))
    expect(onError).toHaveBeenCalledWith('Invalid response data', 'invalid_data', expect.anything())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('lets onUnhandledEvent end the stream with an error', async () => {
    const onError = vi.fn()
    const onCompleted = run(
      () => Promise.resolve(framesOf({ event: 'custom' }, { event: 'node_started' })),
      {
        onError,
        onNotifyError: vi.fn(),
        onUnhandledEvent: () => ({
          errorMessage: 'Unsupported',
          errorCode: 'unsupported',
          messageId: 'm-1',
        }),
      },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(true, 'Unsupported'))
    expect(onError).toHaveBeenCalledWith(
      'Unsupported',
      'unsupported',
      expect.objectContaining({ messageId: 'm-1' }),
    )
  })

  it('warns about unknown events and keeps reading', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onNodeStarted = vi.fn()
    const onCompleted = run(
      () => Promise.resolve(framesOf({ event: 'custom' }, { event: 'node_started' })),
      {
        onNodeStarted,
      },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith())
    expect(warn).toHaveBeenCalledWith('Unknown event: custom', { event: 'custom' })
    expect(onNodeStarted).toHaveBeenCalled()
  })

  it('reports a failed read as a stream read error', async () => {
    async function* failing() {
      yield { event: 'message', answer: 'a', id: 'm-1', conversation_id: 'c-1' }
      throw new TypeError('network error')
    }
    const onError = vi.fn()
    const onCompleted = run(() => Promise.resolve(failing()), { onError })

    await vi.waitFor(() =>
      expect(onCompleted).toHaveBeenCalledWith(true, 'TypeError: network error'),
    )
    expect(onError).toHaveBeenCalledWith(
      'TypeError: network error',
      'stream_read_error',
      expect.anything(),
    )
    expect(toast.error).toHaveBeenCalledWith('TypeError: network error')
  })

  it('reports HTTP errors with the body message and code, then notifies', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    streamEvents(
      () =>
        Promise.reject(
          new ORPCError('HTTP_ERROR', {
            status: 400,
            message: 'Bad',
            data: { code: 'invalid_param', message: 'Invalid inputs' },
          }),
        ),
      { onError, onNotifyError },
    )

    await vi.waitFor(() => expect(onNotifyError).toHaveBeenCalled())
    expect(onError).toHaveBeenCalledWith('Invalid inputs', 'invalid_param')
    expect(onNotifyError).toHaveBeenCalledWith('Invalid inputs', 'invalid_param')
  })

  it('falls back to Server Error and lets onNotifyError replace the toast', async () => {
    const onError = vi.fn()
    streamEvents(() => Promise.reject(new ORPCError('HTTP_ERROR', { status: 502 })), {
      onError,
      onNotifyError: vi.fn(),
    })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Server Error', undefined))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports an unrecovered 401 without a toast', async () => {
    const onError = vi.fn()
    streamEvents(
      () =>
        Promise.reject(
          new ORPCError('unauthorized', {
            status: 401,
            data: { code: 'unauthorized', message: 'Login' },
          }),
        ),
      { onError },
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Login', 'unauthorized'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('leaves WebApp sign-in errors to the request layer redirect', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    for (const data of [
      { code: 'web_sso_auth_required', message: 'SSO' },
      { code: 'unauthorized', message: 'Login' },
      { code: 'forbidden', reason: 'APPDEPLOY_WEB_APP_ACCESS_DENIED', message: 'Denied' },
    ]) {
      streamEvents(() => Promise.reject(new ORPCError(data.code, { status: 401, data })), {
        isPublicAPI: true,
        onError,
        onCompleted,
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onError).not.toHaveBeenCalled()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports other WebApp 403 errors with a toast', async () => {
    const onError = vi.fn()
    streamEvents(
      () =>
        Promise.reject(
          new ORPCError('forbidden', { status: 403, data: { code: 'forbidden', message: 'No' } }),
        ),
      { isPublicAPI: true, onError },
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('No', 'forbidden'))
    expect(toast.error).toHaveBeenCalledWith('No')
  })

  it('reports network errors and stays quiet about aborts', async () => {
    const onError = vi.fn()
    streamEvents(() => Promise.reject(new TypeError('Failed to fetch')), { onError })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('TypeError: Failed to fetch'))
    expect(toast.error).toHaveBeenCalledWith('TypeError: Failed to fetch')

    vi.mocked(toast.error).mockClear()
    const onAbortError = vi.fn()
    streamEvents(
      () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
      {
        onError: onAbortError,
      },
    )
    await vi.waitFor(() =>
      expect(onAbortError).toHaveBeenCalledWith('AbortError: The operation was aborted.'),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('streamGeneratorEvents', () => {
  it('forwards plan and result frames and ignores others', async () => {
    const onPlan = vi.fn()
    const onResult = vi.fn()
    const onCompleted = vi.fn()
    streamGeneratorEvents(
      () =>
        Promise.resolve(
          framesOf(
            { event: 'plan', title: 'X' },
            { event: 'other' },
            { event: 'result', graph: {} },
          ),
        ),
      { onPlan, onResult, onCompleted },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(onPlan).toHaveBeenCalledExactlyOnceWith({ event: 'plan', title: 'X' })
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ event: 'result', graph: {} })
  })

  it('reports HTTP errors through onError only', async () => {
    const onError = vi.fn()
    streamGeneratorEvents(
      () =>
        Promise.reject(
          new ORPCError('HTTP_ERROR', { status: 500, data: { message: 'Planner failed' } }),
        ),
      { onError },
    )
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Planner failed'))

    const onUnauthorized = vi.fn()
    streamGeneratorEvents(() => Promise.reject(new ORPCError('unauthorized', { status: 401 })), {
      onError: onUnauthorized,
    })
    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith('Unauthorized'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('never reports aborts', async () => {
    async function* aborted() {
      yield { event: 'plan' }
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    const onError = vi.fn()
    const onPlan = vi.fn()
    streamGeneratorEvents(() => Promise.resolve(aborted()), { onError, onPlan })

    await vi.waitFor(() => expect(onPlan).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('generated client streams', () => {
  it('sends the completion request through the console contract and parses SSE frames', async () => {
    const message = frame({
      event: 'message',
      answer: 'Hel',
      id: 'm-1',
      conversation_id: 'c-1',
      task_id: 't-1',
    })
    const split = Math.floor(message.length / 2)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        eventStreamResponse([
          'event: ping\n\n',
          message.slice(0, split),
          message.slice(split),
          frame({
            event: 'message',
            answer: 'lo',
            id: 'm-1',
            conversation_id: 'c-1',
            task_id: 't-1',
          }),
          frame({ event: 'message_replace', answer: 'Hello!' }),
          frame({ event: 'message_end', id: 'm-1' }),
        ]),
      ),
    )
    const onData = vi.fn()
    const onMessageReplace = vi.fn()
    const onCompleted = vi.fn()
    const onError = vi.fn()

    void sendCompletionMessage(
      'app-1',
      { inputs: { name: 'x' } },
      {
        onData,
        onMessageReplace,
        onCompleted,
        onError,
      },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(onError).not.toHaveBeenCalled()
    expect(onData.mock.calls.map(([text, isFirst]) => [text, isFirst])).toEqual([
      ['Hel', true],
      ['lo', false],
    ])
    expect(onMessageReplace).toHaveBeenCalledWith({ event: 'message_replace', answer: 'Hello!' })
    expect(onCompleted).toHaveBeenCalledWith()

    const request = await getFetchedRequest()
    expect(request.method).toBe('POST')
    expect(request.url.pathname).toBe('/console/api/apps/app-1/completion-messages')
    expect(JSON.parse(request.body)).toEqual({ inputs: { name: 'x' }, response_mode: 'streaming' })
  })

  it('aborts an open stream without a toast', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Request, init?: RequestInit) => {
        signal = init?.signal ?? input.signal
        return Promise.resolve(
          pendingEventStreamResponse(
            [frame({ event: 'message', answer: 'a', id: 'm-1', conversation_id: 'c-1' })],
            signal,
          ),
        )
      }),
    )
    const onData = vi.fn()
    const onError = vi.fn()
    const onCompleted = vi.fn()
    let controller: AbortController | undefined

    streamEvents(
      (options) =>
        consoleClient.apps.byAppId.completionMessages.post(
          { params: { app_id: 'app-1' }, body: { inputs: {}, response_mode: 'streaming' } },
          options,
        ),
      { onData, onError, onCompleted, getAbortController: (c) => (controller = c) },
    )

    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(1))
    controller!.abort()

    await vi.waitFor(() =>
      expect(onCompleted).toHaveBeenCalledWith(true, expect.stringContaining('AbortError')),
    )
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('AbortError'),
      'stream_read_error',
      expect.anything(),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports an HTTP error response through the callbacks without the request layer toast', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: 'provider_not_initialize', message: 'No provider' },
            { status: 400 },
          ),
        ),
    )
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    void sendCompletionMessage(
      'app-1',
      {},
      {
        onData: vi.fn(),
        onCompleted: vi.fn(),
        onMessageReplace: vi.fn(),
        onError,
        onNotifyError,
      },
    )

    await vi.waitFor(() => expect(onNotifyError).toHaveBeenCalled())
    expect(onError).toHaveBeenCalledWith('No provider', 'provider_not_initialize')
    expect(onNotifyError).toHaveBeenCalledExactlyOnceWith('No provider', 'provider_not_initialize')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('refreshes the session on 401 and retries the stream', async () => {
    refreshAccessTokenOrReLoginMock.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ code: 'unauthorized', message: 'Expired' }, { status: 401 }),
        )
        .mockResolvedValueOnce(eventStreamResponse([frame({ event: 'message_end', id: 'm-1' })])),
    )
    const onCompleted = vi.fn()
    const onError = vi.fn()

    void sendCompletionMessage(
      'app-1',
      {},
      {
        onData: vi.fn(),
        onCompleted,
        onMessageReplace: vi.fn(),
        onError,
      },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith())
    expect(refreshAccessTokenOrReLoginMock).toHaveBeenCalledTimes(1)
    expect(fetchMock()).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
  })

  it('streams the workflow generator plan and result', async () => {
    const result = { event: 'result', graph: { nodes: [{ id: 'node-1', title: '测试' }] } }
    const bytes = encode(frame(result))
    const split = bytes.findIndex((byte) => byte >= 128) + 1
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          eventStreamResponse([
            frame({ event: 'plan', title: 'X' }),
            bytes.slice(0, split),
            bytes.slice(split),
          ]),
        ),
    )
    const onPlan = vi.fn()
    const onResult = vi.fn()
    const onCompleted = vi.fn()
    let controller: AbortController | undefined

    generateWorkflowStream(
      { mode: 'workflow', instruction: 'Build' } as Parameters<typeof generateWorkflowStream>[0],
      {
        onPlan,
        onResult,
        onCompleted,
        getAbortController: (c) => (controller = c),
      },
    )

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(onPlan).toHaveBeenCalledWith({ event: 'plan', title: 'X' })
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result)
    const request = await getFetchedRequest()
    expect(request.url.pathname).toBe('/console/api/workflow-generate/stream')
    expect(request.method).toBe('POST')
    expect(request.signal.aborted).toBe(false)
    controller!.abort()
  })

  describe('when the first frame arrives after the request timeout', () => {
    // ky's request timeout covers the time to response headers, which a stream only sends with
    // its first frame. The legacy SSE helpers had no timeout.
    const REQUEST_TIMEOUT_MS = 100_000

    afterEach(() => {
      vi.useRealTimers()
    })

    /** Answers with the stream only after `delay`, or rejects when the request is aborted. */
    const stubLateFetch = (delay: number, chunks: string[]) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (input: Request, init?: RequestInit) =>
            new Promise<Response>((resolve, reject) => {
              const signal = init?.signal ?? input.signal
              const timer = setTimeout(() => resolve(eventStreamResponse(chunks)), delay)
              signal.addEventListener('abort', () => {
                clearTimeout(timer)
                reject(signal.reason)
              })
            }),
        ),
      )
    }

    it('still delivers the stream', async () => {
      vi.useFakeTimers()
      stubLateFetch(REQUEST_TIMEOUT_MS + 50_000, [
        frame({ event: 'message', answer: 'late', id: 'm-1', conversation_id: 'c-1' }),
        frame({ event: 'message_end', id: 'm-1' }),
      ])
      const onData = vi.fn()
      const onError = vi.fn()
      const onCompleted = vi.fn()

      void sendCompletionMessage(
        'app-1',
        {},
        {
          onData,
          onError,
          onCompleted,
          onMessageReplace: vi.fn(),
        },
      )
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 60_000)
      vi.useRealTimers()

      await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith())
      expect(onData).toHaveBeenCalledWith('late', true, expect.anything())
      expect(onError).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('still delivers the workflow generator result', async () => {
      vi.useFakeTimers()
      stubLateFetch(REQUEST_TIMEOUT_MS + 50_000, [frame({ event: 'result', graph: {} })])
      const onResult = vi.fn()
      const onError = vi.fn()
      const onCompleted = vi.fn()

      generateWorkflowStream(
        { mode: 'workflow', instruction: 'Build' } as Parameters<typeof generateWorkflowStream>[0],
        { onResult, onError, onCompleted },
      )
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 60_000)
      vi.useRealTimers()

      await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())
      expect(onResult).toHaveBeenCalledWith({ event: 'result', graph: {} })
      expect(onError).not.toHaveBeenCalled()
    })

    it('keeps the time limit for JSON calls', async () => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      stubLateFetch(REQUEST_TIMEOUT_MS + 50_000, [])
      const result = consoleClient.workflowGenerate
        .post({ body: { mode: 'workflow', instruction: 'Build' } as never })
        .catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1_000)
      vi.useRealTimers()

      expect(await result).toMatchObject({ name: 'TimeoutError' })
    })

    it('can still be aborted while waiting', async () => {
      vi.useFakeTimers()
      stubLateFetch(REQUEST_TIMEOUT_MS + 50_000, [frame({ event: 'message_end', id: 'm-1' })])
      const onError = vi.fn()
      const onCompleted = vi.fn()
      let controller: AbortController | undefined

      streamEvents(
        (options) =>
          consoleClient.apps.byAppId.completionMessages.post(
            { params: { app_id: 'app-1' }, body: { inputs: {}, response_mode: 'streaming' } },
            options,
          ),
        { onError, onCompleted, getAbortController: (c) => (controller = c) },
      )
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS / 2)
      controller!.abort()
      vi.useRealTimers()

      await vi.waitFor(() =>
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('AbortError')),
      )
      expect(onCompleted).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
