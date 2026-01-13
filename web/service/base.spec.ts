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
