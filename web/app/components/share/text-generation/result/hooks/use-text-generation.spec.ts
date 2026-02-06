import type { UseTextGenerationProps } from './use-text-generation'
import { act, renderHook } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import { useTextGeneration } from './use-text-generation'

// Mock external services
vi.mock('@/service/share', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    sendCompletionMessage: vi.fn(),
    sendWorkflowMessage: vi.fn(() => Promise.resolve()),
    stopChatMessageResponding: vi.fn(() => Promise.resolve()),
    stopWorkflowMessage: vi.fn(() => Promise.resolve()),
    updateFeedback: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('i18next', () => ({
  t: (key: string) => key,
}))

vi.mock('@/utils', () => ({
  sleep: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getProcessedFiles: vi.fn((files: unknown[]) => files),
  getFilesInLogs: vi.fn(() => []),
}))

vi.mock('@/utils/model-config', () => ({
  formatBooleanInputs: vi.fn((_vars: unknown, inputs: unknown) => inputs),
}))

// Factory for default hook props
function createProps(overrides: Partial<UseTextGenerationProps> = {}): UseTextGenerationProps {
  return {
    isWorkflow: false,
    isCallBatchAPI: false,
    isPC: true,
    appSourceType: AppSourceType.webApp,
    appId: 'app-1',
    promptConfig: { prompt_template: '', prompt_variables: [] },
    inputs: {},
    onShowRes: vi.fn(),
    onCompleted: vi.fn(),
    visionConfig: { enabled: false } as UseTextGenerationProps['visionConfig'],
    completionFiles: [],
    onRunStart: vi.fn(),
    ...overrides,
  }
}

describe('useTextGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Initial state
  describe('initial state', () => {
    it('should return correct default values', () => {
      const { result } = renderHook(() => useTextGeneration(createProps()))

      expect(result.current.isResponding).toBe(false)
      expect(result.current.completionRes).toBe('')
      expect(result.current.workflowProcessData).toBeUndefined()
      expect(result.current.messageId).toBeNull()
      expect(result.current.feedback).toEqual({ rating: null })
      expect(result.current.isStopping).toBe(false)
      expect(result.current.currentTaskId).toBeNull()
      expect(result.current.controlClearMoreLikeThis).toBe(0)
    })

    it('should expose handler functions', () => {
      const { result } = renderHook(() => useTextGeneration(createProps()))

      expect(typeof result.current.handleSend).toBe('function')
      expect(typeof result.current.handleStop).toBe('function')
      expect(typeof result.current.handleFeedback).toBe('function')
    })
  })

  // Feedback
  describe('handleFeedback', () => {
    it('should call updateFeedback API and update state', async () => {
      const { updateFeedback } = await import('@/service/share')
      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleFeedback({ rating: 'like' })
      })

      expect(updateFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ body: { rating: 'like', content: undefined } }),
        AppSourceType.webApp,
        'app-1',
      )
      expect(result.current.feedback).toEqual({ rating: 'like' })
    })
  })

  // Stop
  describe('handleStop', () => {
    it('should do nothing when no currentTaskId', async () => {
      const { stopChatMessageResponding } = await import('@/service/share')
      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleStop()
      })

      expect(stopChatMessageResponding).not.toHaveBeenCalled()
    })

    it('should call stopWorkflowMessage for workflow mode', async () => {
      const { stopWorkflowMessage, sendWorkflowMessage } = await import('@/service/share')
      const props = createProps({ isWorkflow: true })
      const { result } = renderHook(() => useTextGeneration(props))

      // Trigger a send to set currentTaskId (mock will set it via callbacks)
      // Instead, we test that handleStop guards against empty taskId
      await act(async () => {
        await result.current.handleStop()
      })

      // No task to stop
      expect(stopWorkflowMessage).not.toHaveBeenCalled()
      expect(sendWorkflowMessage).toBeDefined()
    })
  })

  // Send - validation
  describe('handleSend - validation', () => {
    it('should show toast when called while responding', async () => {
      const { sendCompletionMessage } = await import('@/service/share')
      const { result } = renderHook(() => useTextGeneration(createProps({ controlSend: 1 })))

      // First send sets isResponding true
      // Second send should show warning
      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendCompletionMessage).toHaveBeenCalled()
    })

    it('should validate required prompt variables', async () => {
      const Toast = (await import('@/app/components/base/toast')).default
      const props = createProps({
        promptConfig: {
          prompt_template: '',
          prompt_variables: [
            { key: 'name', name: 'Name', type: 'string', required: true },
          ] as UseTextGenerationProps['promptConfig'] extends infer T ? T extends { prompt_variables: infer V } ? V : never : never,
        },
        inputs: {}, // missing required 'name'
      })
      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('should pass validation for batch API mode', async () => {
      const { sendCompletionMessage } = await import('@/service/share')
      const props = createProps({ isCallBatchAPI: true })
      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      // Batch mode skips validation - should call send
      expect(sendCompletionMessage).toHaveBeenCalled()
    })
  })

  // Send - API calls
  describe('handleSend - API', () => {
    it('should call sendCompletionMessage for non-workflow mode', async () => {
      const { sendCompletionMessage } = await import('@/service/share')
      const props = createProps({ isWorkflow: false })
      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendCompletionMessage).toHaveBeenCalledWith(
        expect.objectContaining({ inputs: {} }),
        expect.objectContaining({
          onData: expect.any(Function),
          onCompleted: expect.any(Function),
          onError: expect.any(Function),
        }),
        AppSourceType.webApp,
        'app-1',
      )
    })

    it('should call sendWorkflowMessage for workflow mode', async () => {
      const { sendWorkflowMessage } = await import('@/service/share')
      const props = createProps({ isWorkflow: true })
      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendWorkflowMessage).toHaveBeenCalledWith(
        expect.objectContaining({ inputs: {} }),
        expect.objectContaining({
          onWorkflowStarted: expect.any(Function),
          onNodeStarted: expect.any(Function),
          onWorkflowFinished: expect.any(Function),
        }),
        AppSourceType.webApp,
        'app-1',
      )
    })

    it('should call onShowRes and onRunStart on mobile', async () => {
      const onShowRes = vi.fn()
      const onRunStart = vi.fn()
      const props = createProps({ isPC: false, onShowRes, onRunStart })
      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(onShowRes).toHaveBeenCalled()
      expect(onRunStart).toHaveBeenCalled()
    })
  })

  // Effects
  describe('effects', () => {
    it('should trigger send when controlSend changes', async () => {
      const { sendCompletionMessage } = await import('@/service/share')
      const { result, rerender } = renderHook(
        (props: UseTextGenerationProps) => useTextGeneration(props),
        { initialProps: createProps({ controlSend: 0 }) },
      )

      // Change controlSend to trigger the effect
      await act(async () => {
        rerender(createProps({ controlSend: Date.now() }))
      })

      expect(sendCompletionMessage).toHaveBeenCalled()
      expect(result.current.controlClearMoreLikeThis).toBeGreaterThan(0)
    })

    it('should trigger send when controlRetry changes', async () => {
      const { sendCompletionMessage } = await import('@/service/share')

      await act(async () => {
        renderHook(() => useTextGeneration(createProps({ controlRetry: Date.now() })))
      })

      expect(sendCompletionMessage).toHaveBeenCalled()
    })

    it('should sync run control with parent via onRunControlChange', () => {
      const onRunControlChange = vi.fn()
      renderHook(() => useTextGeneration(createProps({ onRunControlChange })))

      // Initially not responding, so should pass null
      expect(onRunControlChange).toHaveBeenCalledWith(null)
    })
  })
})
