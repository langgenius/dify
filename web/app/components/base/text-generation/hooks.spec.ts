import type { IOtherOptions } from '@/service/base'
import { act, renderHook } from '@testing-library/react'
import { useTextGeneration } from './hooks'

const mockNotify = vi.fn()
const mockSsePost = vi.fn<(url: string, fetchOptions: { body: Record<string, unknown> }, otherOptions: IOtherOptions) => void>()

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('@/service/base', () => ({
  ssePost: (...args: Parameters<typeof mockSsePost>) => mockSsePost(...args),
}))

const getLatestStreamOptions = (): IOtherOptions => {
  const latestCall = mockSsePost.mock.calls[mockSsePost.mock.calls.length - 1]
  if (!latestCall)
    throw new Error('Expected ssePost to be called at least once')
  return latestCall[2]
}

describe('useTextGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should return expected initial state and handlers', () => {
      const { result } = renderHook(() => useTextGeneration())

      expect(result.current.completion).toBe('')
      expect(result.current.isResponding).toBe(false)
      expect(result.current.messageId).toBeNull()
      expect(result.current.setIsResponding).toBeInstanceOf(Function)
      expect(result.current.handleSend).toBeInstanceOf(Function)
    })
  })

  describe('Send Flow', () => {
    it('should start streaming request and return true when not responding', async () => {
      const { result } = renderHook(() => useTextGeneration())
      let sendResult: boolean | undefined

      await act(async () => {
        sendResult = await result.current.handleSend('/console/api', { query: 'hello' })
      })

      expect(sendResult).toBe(true)
      expect(result.current.isResponding).toBe(true)
      expect(result.current.completion).toBe('')
      expect(result.current.messageId).toBe('')
      expect(mockSsePost).toHaveBeenCalledWith(
        '/console/api',
        {
          body: {
            response_mode: 'streaming',
            query: 'hello',
          },
        },
        expect.objectContaining({
          onData: expect.any(Function),
          onMessageReplace: expect.any(Function),
          onCompleted: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
    })

    it('should append chunks and update messageId when onData is triggered', async () => {
      const { result } = renderHook(() => useTextGeneration())

      await act(async () => {
        await result.current.handleSend('/console/api', { query: 'chunk' })
      })

      const streamOptions = getLatestStreamOptions()
      act(() => {
        streamOptions.onData?.('Hello', true, { messageId: 'message-1' })
      })

      expect(result.current.completion).toBe('Hello')
      expect(result.current.messageId).toBe('message-1')

      act(() => {
        streamOptions.onData?.(' world', false, { messageId: 'message-1' })
      })

      expect(result.current.completion).toBe('Hello world')
      expect(result.current.messageId).toBe('message-1')
    })

    it('should replace completion when onMessageReplace is triggered', async () => {
      const { result } = renderHook(() => useTextGeneration())

      await act(async () => {
        await result.current.handleSend('/console/api', { query: 'replace' })
      })

      const streamOptions = getLatestStreamOptions()
      act(() => {
        streamOptions.onData?.('Old content', true, { messageId: 'message-2' })
      })

      const replaceMessage = { answer: 'New content' } as Parameters<NonNullable<IOtherOptions['onMessageReplace']>>[0]
      act(() => {
        streamOptions.onMessageReplace?.(replaceMessage)
      })

      expect(result.current.completion).toBe('New content')
    })

    it('should set responding to false when stream completes', async () => {
      const { result } = renderHook(() => useTextGeneration())

      await act(async () => {
        await result.current.handleSend('/console/api', { query: 'done' })
      })
      expect(result.current.isResponding).toBe(true)

      const streamOptions = getLatestStreamOptions()
      act(() => {
        streamOptions.onCompleted?.()
      })

      expect(result.current.isResponding).toBe(false)
    })

    it('should set responding to false when stream errors', async () => {
      const { result } = renderHook(() => useTextGeneration())

      await act(async () => {
        await result.current.handleSend('/console/api', { query: 'error' })
      })
      expect(result.current.isResponding).toBe(true)

      const streamOptions = getLatestStreamOptions()
      act(() => {
        streamOptions.onError?.('something went wrong')
      })

      expect(result.current.isResponding).toBe(false)
    })

    it('should notify and return false when called while already responding', async () => {
      const { result } = renderHook(() => useTextGeneration())
      let sendResult: boolean | undefined

      act(() => {
        result.current.setIsResponding(true)
      })

      await act(async () => {
        sendResult = await result.current.handleSend('/console/api', { query: 'wait' })
      })

      expect(sendResult).toBe(false)
      expect(mockSsePost).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'info',
        message: 'appDebug.errorMessage.waitForResponse',
      })
    })
  })
})
