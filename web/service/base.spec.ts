import { toast } from '@langgenius/dify-ui/toast'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// eslint-disable-next-line no-restricted-imports
import { del, get, handleStream, patch, post, put, sseGet, ssePost } from './base'

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
