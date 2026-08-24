import { toast } from '@langgenius/dify-ui/toast'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports
import {
  del,
  get,
  handleStream,
  patch,
  post,
  postPublic,
  put,
  sseGet,
  ssePost,
  upload,
} from './base'

const refreshAccessTokenOrReLoginMock = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('./refresh-token', () => ({
  refreshAccessTokenOrReLogin: refreshAccessTokenOrReLoginMock,
}))

describe('handleStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Invalid response data handling', () => {
    it('should handle null bufferObj from JSON.parse gracefully', async () => {
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: null\n'),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      handleStream(mockResponse, onData, onCompleted)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(onData).toHaveBeenCalledWith('', true, {
        conversationId: undefined,
        messageId: '',
        errorMessage: 'Invalid response data',
        errorCode: 'invalid_data',
      })
      expect(onCompleted).toHaveBeenCalledWith(true, 'Invalid response data')
    })

    it('should handle non-object bufferObj from JSON.parse gracefully', async () => {
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: "string"\n'),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      handleStream(mockResponse, onData, onCompleted)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(onData).toHaveBeenCalledWith('', true, {
        conversationId: undefined,
        messageId: '',
        errorMessage: 'Invalid response data',
        errorCode: 'invalid_data',
      })
      expect(onCompleted).toHaveBeenCalledWith(true, 'Invalid response data')
    })

    it('should handle valid message event correctly', async () => {
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const validMessage = {
        event: 'message',
        answer: 'Hello world',
        conversation_id: 'conv-123',
        task_id: 'task-456',
        id: 'msg-789',
      }

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(`data: ${JSON.stringify(validMessage)}\n`),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      handleStream(mockResponse, onData, onCompleted)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(onData).toHaveBeenCalledWith('Hello world', true, {
        event: 'message',
        conversationId: 'conv-123',
        taskId: 'task-456',
        messageId: 'msg-789',
      })
      expect(onCompleted).toHaveBeenCalled()
    })

    it('should handle error status 400 correctly', async () => {
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const errorMessage = {
        status: 400,
        message: 'Bad request',
        code: 'bad_request',
      }

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(`data: ${JSON.stringify(errorMessage)}\n`),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      handleStream(mockResponse, onData, onCompleted)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(onData).toHaveBeenCalledWith('', false, {
        conversationId: undefined,
        messageId: '',
        errorMessage: 'Bad request',
        errorCode: 'bad_request',
      })
      expect(onCompleted).toHaveBeenCalledWith(true, 'Bad request')
    })

    it.each([
      {
        name: 'an error event',
        payload: {
          event: 'error',
          message: 'Stream failed',
          code: 'stream_failed',
        },
      },
      {
        name: 'a numeric error status',
        payload: {
          event: 'message',
          status: 500,
          message: 'Internal server error',
          code: 'internal_server_error',
        },
      },
    ])('should handle $name through the error callbacks', async ({ payload }) => {
      const onData = vi.fn()
      const onCompleted = vi.fn()
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n`),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      handleStream(mockResponse, onData, onCompleted)

      await waitFor(() => {
        expect(onData).toHaveBeenCalledWith('', false, {
          conversationId: undefined,
          messageId: '',
          errorMessage: payload.message,
          errorCode: payload.code,
        })
      })
      expect(onCompleted).toHaveBeenCalledWith(true, payload.message)
    })

    it('should handle malformed JSON gracefully', async () => {
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {invalid json}\n'),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      handleStream(mockResponse, onData, onCompleted)

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(onData).toHaveBeenCalled()
      expect(onCompleted).toHaveBeenCalled()
    })

    it('should dispatch reasoning_chunk events to onReasoning', async () => {
      const onData = vi.fn()
      const onCompleted = vi.fn()
      const onReasoning = vi.fn()

      const reasoningEvent = {
        event: 'reasoning_chunk',
        task_id: 'task-1',
        data: { message_id: 'm-1', reasoning: 'let me think', node_id: 'llm', is_final: false },
      }

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(`data: ${JSON.stringify(reasoningEvent)}\n`),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      const interveningNoops = Array.from({ length: 29 }, () => undefined)

      ;(handleStream as (...args: unknown[]) => void)(
        mockResponse,
        onData,
        onCompleted,
        ...interveningNoops,
        onReasoning,
      )

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(onReasoning).toHaveBeenCalledWith(reasoningEvent)
      expect(onData).not.toHaveBeenCalled()
    })

    it('should complete with error when the stream reader rejects', async () => {
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const mockReader = {
        read: vi.fn().mockRejectedValueOnce(new Error('stream lost')),
      }

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      } as unknown as Response

      handleStream(mockResponse, onData, onCompleted)

      await waitFor(() => {
        expect(onData).toHaveBeenCalledWith('', false, {
          conversationId: undefined,
          messageId: '',
          errorMessage: 'Error: stream lost',
          errorCode: 'stream_read_error',
        })
      })
      expect(onCompleted).toHaveBeenCalledWith(true, 'Error: stream lost')
    })

    it('should throw error when response is not ok', () => {
      const onData = vi.fn()
      const mockResponse = {
        ok: false,
      } as unknown as Response

      expect(() => handleStream(mockResponse, onData)).toThrow('Network response was not ok')
    })
  })
})

describe('ssePost and sseGet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
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
    expect(onError).toHaveBeenCalledWith('Server Error')
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
    const mockReader = {
      read: vi.fn().mockRejectedValueOnce(new Error('stream lost')),
    }
    const response = {
      status: 200,
      ok: true,
      body: {
        getReader: () => mockReader,
      },
    } as unknown as Response

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

  it('should not notify when the stream reader is aborted', async () => {
    const onError = vi.fn()
    const onNotifyError = vi.fn()
    const onCompleted = vi.fn()
    const mockReader = {
      read: vi
        .fn()
        .mockRejectedValueOnce(new DOMException('BodyStreamBuffer was aborted', 'AbortError')),
    }
    const response = {
      status: 200,
      ok: true,
      body: {
        getReader: () => mockReader,
      },
    } as unknown as Response

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

  it('uses the environment webapp API for workflow runs and stops', async () => {
    window.history.replaceState({}, '', '/env/workflow/workflow-app')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    await ssePost('/workflows/run', { body: { inputs: {} } }, { isPublicAPI: true })
    await postPublic('/workflows/tasks/task-1/stop')

    expect(fetchSpy.mock.calls[0]![0]).toBe(`${PUBLIC_API_PREFIX}/env/workflow-app/workflows/run`)
    const stopRequest = fetchSpy.mock.calls[1]![0]
    expect(stopRequest).toBeInstanceOf(Request)
    if (!(stopRequest instanceof Request)) throw new TypeError('Expected a request')
    expect(stopRequest.url).toBe(
      `${PUBLIC_API_PREFIX}/env/workflow-app/workflows/tasks/task-1/stop`,
    )
  })

  it('uses the environment webapp API for local and remote uploads', async () => {
    window.history.replaceState({}, '', '/env/workflow/workflow-app')
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
      `${PUBLIC_API_PREFIX}/env/workflow-app/files/upload`,
      `${PUBLIC_API_PREFIX}/env/workflow-app/remote-files/upload`,
    ])
  })
})

describe('HTTP methods', () => {
  it('should export methods correctly', () => {
    expect(typeof get).toBe('function')
    expect(typeof post).toBe('function')
    expect(typeof put).toBe('function')
    expect(typeof patch).toBe('function')
    expect(typeof del).toBe('function')
  })
})
