import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleStream } from './base'

describe('handleStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Invalid response data handling', () => {
    it('should handle null bufferObj from JSON.parse gracefully', async () => {
      // Arrange
      const onData = vi.fn()
      const onCompleted = vi.fn()

      // Create a mock response that returns 'data: null'
      const mockReader = {
        read: vi.fn()
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

      // Act
      handleStream(mockResponse, onData, onCompleted)

      // Wait for the stream to be processed
      await new Promise(resolve => setTimeout(resolve, 50))

      // Assert
      expect(onData).toHaveBeenCalledWith('', true, {
        conversationId: undefined,
        messageId: '',
        errorMessage: 'Invalid response data',
        errorCode: 'invalid_data',
      })
      expect(onCompleted).toHaveBeenCalledWith(true, 'Invalid response data')
    })

    it('should handle non-object bufferObj from JSON.parse gracefully', async () => {
      // Arrange
      const onData = vi.fn()
      const onCompleted = vi.fn()

      // Create a mock response that returns a primitive value
      const mockReader = {
        read: vi.fn()
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

      // Act
      handleStream(mockResponse, onData, onCompleted)

      // Wait for the stream to be processed
      await new Promise(resolve => setTimeout(resolve, 50))

      // Assert
      expect(onData).toHaveBeenCalledWith('', true, {
        conversationId: undefined,
        messageId: '',
        errorMessage: 'Invalid response data',
        errorCode: 'invalid_data',
      })
      expect(onCompleted).toHaveBeenCalledWith(true, 'Invalid response data')
    })

    it('should handle valid message event correctly', async () => {
      // Arrange
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
        read: vi.fn()
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

      // Act
      handleStream(mockResponse, onData, onCompleted)

      // Wait for the stream to be processed
      await new Promise(resolve => setTimeout(resolve, 50))

      // Assert
      expect(onData).toHaveBeenCalledWith('Hello world', true, {
        conversationId: 'conv-123',
        taskId: 'task-456',
        messageId: 'msg-789',
      })
      expect(onCompleted).toHaveBeenCalled()
    })

    it('should handle error status 400 correctly', async () => {
      // Arrange
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const errorMessage = {
        status: 400,
        message: 'Bad request',
        code: 'bad_request',
      }

      const mockReader = {
        read: vi.fn()
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

      // Act
      handleStream(mockResponse, onData, onCompleted)

      // Wait for the stream to be processed
      await new Promise(resolve => setTimeout(resolve, 50))

      // Assert
      expect(onData).toHaveBeenCalledWith('', false, {
        conversationId: undefined,
        messageId: '',
        errorMessage: 'Bad request',
        errorCode: 'bad_request',
      })
      expect(onCompleted).toHaveBeenCalledWith(true, 'Bad request')
    })

    it('should handle malformed JSON gracefully', async () => {
      // Arrange
      const onData = vi.fn()
      const onCompleted = vi.fn()

      const mockReader = {
        read: vi.fn()
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

      // Act
      handleStream(mockResponse, onData, onCompleted)

      // Wait for the stream to be processed
      await new Promise(resolve => setTimeout(resolve, 50))

      // Assert - malformed JSON triggers the catch block which calls onData and returns
      expect(onData).toHaveBeenCalled()
      expect(onCompleted).toHaveBeenCalled()
    })

    it('should dispatch reasoning_chunk events to onReasoning', async () => {
      // Arrange
      const onData = vi.fn()
      const onCompleted = vi.fn()
      const onReasoning = vi.fn()

      const reasoningEvent = {
        event: 'reasoning_chunk',
        task_id: 'task-1',
        data: { message_id: 'm-1', reasoning: 'let me think', node_id: 'llm', is_final: false },
      }

      const mockReader = {
        read: vi.fn()
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

      // onReasoning is the last positional handler; fill the unused intervening slots.
      const interveningNoops = Array.from({ length: 29 }, () => undefined)

      // Act
      ;(handleStream as (...args: unknown[]) => void)(
        mockResponse,
        onData,
        onCompleted,
        ...interveningNoops,
        onReasoning,
      )

      // Wait for the stream to be processed
      await new Promise(resolve => setTimeout(resolve, 50))

      // Assert - the full event object is forwarded to onReasoning, answer stays untouched
      expect(onReasoning).toHaveBeenCalledWith(reasoningEvent)
      expect(onData).not.toHaveBeenCalled()
    })

    it('should throw error when response is not ok', () => {
      // Arrange
      const onData = vi.fn()
      const mockResponse = {
        ok: false,
      } as unknown as Response

      // Act & Assert
      expect(() => handleStream(mockResponse, onData)).toThrow('Network response was not ok')
    })
  })
})

describe('sseGeneratorPost', () => {
  it('should call fetch and process data correctly', async () => {
    const { sseGeneratorPost } = await import('./base');
    const mockOnPlan = vi.fn()
    const mockOnResult = vi.fn()
    const mockOnCompleted = vi.fn()
    
    // Create a mock stream reader
    const mockReader = {
      read: vi.fn()
    }
    
    // Setup the mock reader to return two chunks then done
    const encoder = new TextEncoder()
    mockReader.read.mockResolvedValueOnce({
      done: false,
      value: encoder.encode('data: {"event":"plan","plan":"test"}\n\n')
    }).mockResolvedValueOnce({
      done: false,
      value: encoder.encode('data: {"event":"result","result":"test"}\n\n')
    }).mockResolvedValueOnce({
      done: true
    })
    
    // Setup global fetch mock
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        getReader: () => mockReader
      }
    })
    
    sseGeneratorPost('/test-url', { test: true }, {
      onPlan: mockOnPlan,
      onResult: mockOnResult,
      onCompleted: mockOnCompleted
    })
    
    // Give promises time to resolve
    await new Promise(resolve => setTimeout(resolve, 100))
    
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(mockOnPlan).toHaveBeenCalledWith({ event: 'plan', plan: 'test' })
    expect(mockOnResult).toHaveBeenCalledWith({ event: 'result', result: 'test' })
    expect(mockOnCompleted).toHaveBeenCalled()
  })

  it('should handle partial JSON properly', async () => {
    const { sseGeneratorPost } = await import('./base');
    const mockOnPlan = vi.fn()
    
    const mockReader = { read: vi.fn() }
    const encoder = new TextEncoder()
    
    // Return partial JSON in first chunk, rest in second chunk
    mockReader.read.mockResolvedValueOnce({
      done: false,
      value: encoder.encode('data: {"event":"plan","plan')
    }).mockResolvedValueOnce({
      done: false,
      value: encoder.encode('":"test"}\n\n')
    }).mockResolvedValueOnce({
      done: true
    })
    
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      body: { getReader: () => mockReader }
    })
    
    sseGeneratorPost('/test-url', {}, { onPlan: mockOnPlan })
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    expect(mockOnPlan).toHaveBeenCalledWith({ event: 'plan', plan: 'test' })
  })

  it('should handle errors gracefully', async () => {
    const { sseGeneratorPost } = await import('./base');
    const mockOnError = vi.fn()
    
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 500,
      json: vi.fn().mockResolvedValue({ message: 'Server error' })
    })
    
    sseGeneratorPost('/test-url', {}, { onError: mockOnError })
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    expect(mockOnError).toHaveBeenCalledWith('Server error')
  })
})
