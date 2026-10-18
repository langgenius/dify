import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports
import { handleStream, postPublic, sseGet, ssePost, upload } from './base'

const refreshAccessTokenOrReLoginMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('./refresh-token', () => ({
  refreshAccessTokenOrReLogin: refreshAccessTokenOrReLoginMock,
}))

const streamResponse = (chunks: (string | Uint8Array)[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

const failedStream = (error: Error) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error)
      },
    }),
  )

describe('handleStream', () => {
  it.each([null, 'string', 42])('reports invalid event payload %s once', async (payload) => {
    const onData = vi.fn()
    const onCompleted = vi.fn()
    handleStream(streamResponse([`data: ${JSON.stringify(payload)}\n`]), onData, onCompleted)
    await waitFor(() =>
      expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true, 'Invalid response data'),
    )
    expect(onData).toHaveBeenCalledExactlyOnceWith('', true, {
      conversationId: undefined,
      messageId: '',
      errorMessage: 'Invalid response data',
      errorCode: 'invalid_data',
    })
  })

  it('delivers each UTF-8 message once across arbitrary network chunk boundaries', async () => {
    const onData = vi.fn()
    const onCompleted = vi.fn()
    const first = `data: ${JSON.stringify({ event: 'message', answer: '你好', conversation_id: 'conv-1', task_id: 'task-1', id: 'message-1' })}`
    const encoded = new TextEncoder().encode(first)
    const split = new TextEncoder().encode(first.slice(0, first.indexOf('你'))).length + 1
    const second = `data: ${JSON.stringify({ event: 'message', answer: ' world', conversation_id: 'conv-1', task_id: 'task-1', id: 'message-1' })}\n`
    handleStream(
      streamResponse([encoded.slice(0, split), encoded.slice(split), '\n', second]),
      onData,
      onCompleted,
    )
    await waitFor(() => expect(onCompleted).toHaveBeenCalledExactlyOnceWith())
    expect(onData.mock.calls).toEqual([
      [
        '你好',
        true,
        { event: 'message', conversationId: 'conv-1', taskId: 'task-1', messageId: 'message-1' },
      ],
      [
        ' world',
        false,
        { event: 'message', conversationId: 'conv-1', taskId: 'task-1', messageId: 'message-1' },
      ],
    ])
  })

  it.each([
    { status: 400, message: 'Bad request', code: 'bad_request' },
    { event: 'error', message: 'Stream failed', code: 'stream_failed' },
    { event: 'message', status: 500, message: 'Server failed', code: 'server_error' },
  ])(
    'stops at the stream error $code, including other events in the same chunk',
    async (payload) => {
      const onData = vi.fn()
      const onCompleted = vi.fn()
      handleStream(
        streamResponse([
          `data: ${JSON.stringify(payload)}\ndata: {"event":"message","answer":"must not appear"}\n`,
        ]),
        onData,
        onCompleted,
      )
      await waitFor(() =>
        expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true, payload.message),
      )
      expect(onData).toHaveBeenCalledExactlyOnceWith('', false, {
        conversationId: undefined,
        messageId: '',
        errorMessage: payload.message,
        errorCode: payload.code,
      })
    },
  )

  it('continues with valid events after a malformed JSON line', async () => {
    const onData = vi.fn()
    const onCompleted = vi.fn()
    handleStream(
      streamResponse([
        'data: {invalid json}\ndata: {"event":"message","answer":"recovered","id":"message-1"}\n',
      ]),
      onData,
      onCompleted,
    )
    await waitFor(() => expect(onCompleted).toHaveBeenCalledExactlyOnceWith())
    expect(onData).toHaveBeenLastCalledWith(
      'recovered',
      true,
      expect.objectContaining({ messageId: 'message-1' }),
    )
    expect(onCompleted).not.toHaveBeenCalledWith(true, expect.anything())
  })

  it('reports a lost stream through both error callbacks', async () => {
    const onData = vi.fn()
    const onCompleted = vi.fn()
    handleStream(failedStream(new Error('stream lost')), onData, onCompleted)
    await waitFor(() =>
      expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true, 'Error: stream lost'),
    )
    expect(onData).toHaveBeenCalledExactlyOnceWith('', false, {
      conversationId: undefined,
      messageId: '',
      errorMessage: 'Error: stream lost',
      errorCode: 'stream_read_error',
    })
  })

  it('rejects a failed HTTP response before reading events', () => {
    expect(() => handleStream(new Response(null, { status: 500 }), vi.fn())).toThrow(
      'Network response was not ok',
    )
  })
})

describe('ssePost and sseGet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('should report fetch failures through onError without throwing from the catch handler', async () => {
    const onError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Network failed'))

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('TypeError: Network failed')
    })
    expect(toast.error).toHaveBeenCalledWith('TypeError: Network failed')
  })

  it('should route fetch failures through a custom notifier', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Network failed'))

    await ssePost('/chat-messages', { body: { query: 'hello' } }, { onError, onNotifyError })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('TypeError: Network failed')
    })
    expect(onNotifyError).toHaveBeenCalledWith('TypeError: Network failed')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should route the response error through a custom notifier', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Base model not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await ssePost('/chat-messages', { body: { query: 'hello' } }, { onError, onNotifyError })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Base model not found')
    })
    expect(onNotifyError).toHaveBeenCalledWith('Base model not found')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should route event stream response errors through a custom notifier', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Workflow resume failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await sseGet('/workflow/workflow-run-1/events', {}, { onError, onNotifyError })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Workflow resume failed')
    })
    expect(onNotifyError).toHaveBeenCalledWith('Workflow resume failed')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should preserve the default response error notification', async () => {
    const onError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Base model not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await ssePost('/chat-messages', { body: { query: 'hello' } }, { onError })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Base model not found')
    })
    expect(onError).toHaveBeenCalledWith('Base model not found')
  })

  it('should preserve the response error for silent requests without notifying', async () => {
    const onError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'model_not_found', message: 'Base model not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await ssePost('/chat-messages', { body: { query: 'hello' } }, { onError, silent: true })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Base model not found', 'model_not_found')
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should route the stream error through a custom notifier', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"event":"error","message":"Base model not found","code":"model_not_found"}\n',
          ),
        )
        controller.close()
      },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body, { status: 200 }))

    await ssePost('/chat-messages', { body: { query: 'hello' } }, { onError, onNotifyError })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Base model not found', 'model_not_found')
    })
    expect(onNotifyError).toHaveBeenCalledWith('Base model not found', 'model_not_found')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should report token refresh failures through onError', async () => {
    const onError = vi.fn()
    refreshAccessTokenOrReLoginMock.mockRejectedValueOnce(new Error('refresh failed'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }))

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Error: refresh failed')
    })
  })

  it('should report event stream token refresh failures through onError', async () => {
    const onError = vi.fn()
    refreshAccessTokenOrReLoginMock.mockRejectedValueOnce(new Error('resume refresh failed'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }))

    await sseGet(
      '/workflow/workflow-run-1/events',
      {},
      {
        onError,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Error: resume refresh failed')
    })
  })

  it('should report stream reader failures through onError and onCompleted', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    const response = failedStream(new Error('stream lost'))

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
        onCompleted,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Error: stream lost', 'stream_read_error')
    })
    expect(onCompleted).toHaveBeenCalledWith(true, 'Error: stream lost')
    expect(toast.error).toHaveBeenCalledWith('Error: stream lost')
  })

  it('should not notify stream reader failures when silent', async () => {
    const onError = vi.fn()
    const onCompleted = vi.fn()
    const response = failedStream(new Error('stream lost'))

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
        onCompleted,
        silent: true,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Error: stream lost', 'stream_read_error')
    })
    expect(onCompleted).toHaveBeenCalledWith(true, 'Error: stream lost')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should not notify when the stream reader is aborted', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    const onCompleted = vi.fn()
    const response = failedStream(new DOMException('BodyStreamBuffer was aborted', 'AbortError'))

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    await ssePost(
      '/chat-messages',
      {
        body: {
          query: 'hello',
        },
      },
      {
        onError,
        onNotifyError,
        onCompleted,
      },
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'AbortError: BodyStreamBuffer was aborted',
        'stream_read_error',
      )
    })
    expect(onCompleted).toHaveBeenCalledWith(true, 'AbortError: BodyStreamBuffer was aborted')
    expect(onNotifyError).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('dispatches reasoning and typed audio through the named SSE callbacks', async () => {
    const onReasoning = vi.fn()
    const onTTSChunk = vi.fn()
    const onCompleted = vi.fn()
    const reasoning = {
      event: 'reasoning_chunk',
      task_id: 'task-1',
      data: { message_id: 'm-1', reasoning: 'let me think', node_id: 'llm', is_final: false },
    }
    const audio = {
      event: 'tts_message',
      message_id: 'm-1',
      audio: 'audio-chunk',
      audio_type: 'audio/wav',
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      streamResponse([`data: ${JSON.stringify(reasoning)}\ndata: ${JSON.stringify(audio)}\n`]),
    )
    await ssePost(
      '/chat-messages',
      { body: { query: 'hello' } },
      { onReasoning, onTTSChunk, onCompleted },
    )
    await waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(onReasoning).toHaveBeenCalledExactlyOnceWith(reasoning)
    expect(onTTSChunk).toHaveBeenCalledExactlyOnceWith('m-1', 'audio-chunk', 'audio/wav')
  })

  it('uses the environment webapp API for workflow runs and stops', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    await ssePost('/workflows/run', { body: { inputs: {} } }, { isPublicAPI: true })
    await postPublic('/workflows/tasks/task-1/stop')

    expect(fetchSpy.mock.calls[0]![0]).toBe(
      `${PUBLIC_API_PREFIX}/environment/workflow-app/workflows/run`,
    )
    const stopRequest = fetchSpy.mock.calls[1]![0]
    expect(stopRequest).toBeInstanceOf(Request)
    if (!(stopRequest instanceof Request)) throw new TypeError('Expected a request')
    expect(stopRequest.url).toBe(
      `${PUBLIC_API_PREFIX}/environment/workflow-app/workflows/tasks/task-1/stop`,
    )
  })

  it('uses the environment webapp API for local and remote uploads', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')
    const urls: string[] = []
    const createXhr = () => {
      const xhr = {
        open: (_method: string, url: string) => urls.push(url),
        setRequestHeader: vi.fn(),
        send: vi.fn(function (this: { onreadystatechange?: () => void }) {
          this.onreadystatechange?.()
        }),
        status: 201,
        response: { id: 'file-1' },
        readyState: 4,
        upload: {},
        withCredentials: false,
        responseType: '',
      }
      return xhr as unknown as XMLHttpRequest
    }

    await upload({ xhr: createXhr(), data: new FormData() }, true)
    await upload({ xhr: createXhr(), data: new FormData() }, true, '/remote-files/upload')

    expect(urls).toEqual([
      `${PUBLIC_API_PREFIX}/environment/workflow-app/files/upload`,
      `${PUBLIC_API_PREFIX}/environment/workflow-app/remote-files/upload`,
    ])
  })
})
