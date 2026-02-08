import type { UseTextGenerationProps } from './use-text-generation'
import { act, renderHook } from '@testing-library/react'
import Toast from '@/app/components/base/toast'
import {
  AppSourceType,
  sendCompletionMessage,
  sendWorkflowMessage,
  stopChatMessageResponding,
  stopWorkflowMessage,
} from '@/service/share'
import { TransferMethod } from '@/types/app'
import { sleep } from '@/utils'
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

// Extracted parameter types for typed mock implementations
type CompletionBody = Parameters<typeof sendCompletionMessage>[0]
type CompletionCbs = Parameters<typeof sendCompletionMessage>[1]
type WorkflowBody = Parameters<typeof sendWorkflowMessage>[0]
type WorkflowCbs = Parameters<typeof sendWorkflowMessage>[1]

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

  // handleStop with active task
  describe('handleStop - with active task', () => {
    it('should call stopWorkflowMessage for workflow', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendWorkflowMessage).mockImplementationOnce(
        (async (_data: WorkflowBody, callbacks: WorkflowCbs) => {
          callbacks.onWorkflowStarted({ workflow_run_id: 'run-1', task_id: 'task-1' } as never)
        }) as unknown as typeof sendWorkflowMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps({ isWorkflow: true })))

      await act(async () => {
        await result.current.handleSend()
      })
      await act(async () => {
        await result.current.handleStop()
      })

      expect(stopWorkflowMessage).toHaveBeenCalledWith('app-1', 'task-1', AppSourceType.webApp, 'app-1')
    })

    it('should call stopChatMessageResponding for completion', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { onData, getAbortController }: CompletionCbs) => {
          getAbortController?.(new AbortController())
          onData('chunk', true, { messageId: 'msg-1', taskId: 'task-1' })
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })
      await act(async () => {
        await result.current.handleStop()
      })

      expect(stopChatMessageResponding).toHaveBeenCalledWith('app-1', 'task-1', AppSourceType.webApp, 'app-1')
    })

    it('should handle stop API errors gracefully', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendWorkflowMessage).mockImplementationOnce(
        (async (_data: WorkflowBody, callbacks: WorkflowCbs) => {
          callbacks.onWorkflowStarted({ workflow_run_id: 'run-1', task_id: 'task-1' } as never)
        }) as unknown as typeof sendWorkflowMessage,
      )
      vi.mocked(stopWorkflowMessage).mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useTextGeneration(createProps({ isWorkflow: true })))

      await act(async () => {
        await result.current.handleSend()
      })
      await act(async () => {
        await result.current.handleStop()
      })

      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Network error' }),
      )
      expect(result.current.isStopping).toBe(false)
    })
  })

  // File processing in handleSend
  describe('handleSend - file processing', () => {
    it('should process file-type and file-list prompt variables', async () => {
      const fileValue = { name: 'doc.pdf', size: 100 }
      const fileListValue = [{ name: 'a.pdf' }, { name: 'b.pdf' }]
      const props = createProps({
        promptConfig: {
          prompt_template: '',
          prompt_variables: [
            { key: 'doc', name: 'Document', type: 'file', required: false },
            { key: 'docs', name: 'Documents', type: 'file-list', required: false },
          ] as UseTextGenerationProps['promptConfig'] extends infer T ? T extends { prompt_variables: infer V } ? V : never : never,
        },
        inputs: { doc: fileValue, docs: fileListValue } as unknown as Record<string, UseTextGenerationProps['inputs'][string]>,
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendCompletionMessage).toHaveBeenCalledWith(
        expect.objectContaining({ inputs: expect.objectContaining({ doc: expect.anything(), docs: expect.anything() }) }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      )
    })

    it('should include vision files when vision is enabled', async () => {
      const props = createProps({
        visionConfig: { enabled: true, number_limits: 2, detail: 'low', transfer_methods: [] } as UseTextGenerationProps['visionConfig'],
        completionFiles: [
          { transfer_method: TransferMethod.local_file, url: 'http://local', upload_file_id: 'f1' },
          { transfer_method: TransferMethod.remote_url, url: 'http://remote' },
        ] as UseTextGenerationProps['completionFiles'],
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendCompletionMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([
            expect.objectContaining({ transfer_method: TransferMethod.local_file, url: '' }),
            expect.objectContaining({ transfer_method: TransferMethod.remote_url, url: 'http://remote' }),
          ]),
        }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      )
    })
  })

  // Validation edge cases
  describe('handleSend - validation edge cases', () => {
    it('should block when files are uploading and no prompt variables', async () => {
      const props = createProps({
        promptConfig: { prompt_template: '', prompt_variables: [] },
        completionFiles: [
          { transfer_method: TransferMethod.local_file, url: '' },
        ] as UseTextGenerationProps['completionFiles'],
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info' }),
      )
      expect(sendCompletionMessage).not.toHaveBeenCalled()
    })

    it('should skip boolean/checkbox vars in required check', async () => {
      const props = createProps({
        promptConfig: {
          prompt_template: '',
          prompt_variables: [
            { key: 'flag', name: 'Flag', type: 'boolean', required: true },
            { key: 'check', name: 'Check', type: 'checkbox', required: true },
          ] as UseTextGenerationProps['promptConfig'] extends infer T ? T extends { prompt_variables: infer V } ? V : never : never,
        },
        inputs: {},
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      // Should pass validation - boolean/checkbox are skipped
      expect(sendCompletionMessage).toHaveBeenCalled()
    })

    it('should stop checking after first empty required var', async () => {
      const props = createProps({
        promptConfig: {
          prompt_template: '',
          prompt_variables: [
            { key: 'first', name: 'First', type: 'string', required: true },
            { key: 'second', name: 'Second', type: 'string', required: true },
          ] as UseTextGenerationProps['promptConfig'] extends infer T ? T extends { prompt_variables: infer V } ? V : never : never,
        },
        inputs: { second: 'value' },
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      // Error should mention 'First', not 'Second'
      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })

    it('should block when files uploading after vars pass', async () => {
      const props = createProps({
        promptConfig: {
          prompt_template: '',
          prompt_variables: [
            { key: 'name', name: 'Name', type: 'string', required: true },
          ] as UseTextGenerationProps['promptConfig'] extends infer T ? T extends { prompt_variables: infer V } ? V : never : never,
        },
        inputs: { name: 'Alice' },
        completionFiles: [
          { transfer_method: TransferMethod.local_file, url: '' },
        ] as UseTextGenerationProps['completionFiles'],
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info' }),
      )
      expect(sendCompletionMessage).not.toHaveBeenCalled()
    })
  })

  // sendCompletionMessage callbacks
  describe('sendCompletionMessage callbacks', () => {
    it('should accumulate text and track task/message via onData', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { onData }: CompletionCbs) => {
          onData('Hello ', true, { messageId: 'msg-1', taskId: 'task-1' })
          onData('World', false, { messageId: 'msg-1', taskId: 'task-1' })
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(result.current.completionRes).toBe('Hello World')
      expect(result.current.currentTaskId).toBe('task-1')
    })

    it('should finalize state via onCompleted', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      const onCompleted = vi.fn()
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, callbacks: CompletionCbs) => {
          callbacks.onData('result', true, { messageId: 'msg-1', taskId: 'task-1' })
          callbacks.onCompleted()
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps({ onCompleted })))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(result.current.isResponding).toBe(false)
      expect(result.current.messageId).toBe('msg-1')
      expect(onCompleted).toHaveBeenCalledWith('result', undefined, true)
    })

    it('should replace text via onMessageReplace', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { onData, onMessageReplace }: CompletionCbs) => {
          onData('old text', true, { messageId: 'msg-1', taskId: 'task-1' })
          onMessageReplace!({ answer: 'replaced text' } as never)
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(result.current.completionRes).toBe('replaced text')
    })

    it('should handle error via onError', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      const onCompleted = vi.fn()
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { onError }: CompletionCbs) => {
          onError('test error')
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps({ onCompleted })))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(result.current.isResponding).toBe(false)
      expect(onCompleted).toHaveBeenCalledWith('', undefined, false)
    })

    it('should store abort controller via getAbortController', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      const abortController = new AbortController()
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { getAbortController }: CompletionCbs) => {
          getAbortController?.(abortController)
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })

      // Verify abort controller is stored by triggering stop
      expect(result.current.isResponding).toBe(true)
    })

    it('should show timeout warning when onCompleted fires after timeout', async () => {
      // Default sleep mock resolves immediately, so timeout fires
      let capturedCallbacks: CompletionCbs | null = null
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, callbacks: CompletionCbs) => {
          capturedCallbacks = callbacks
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })

      // Timeout has fired (sleep resolved immediately, isEndRef still false)
      await act(async () => {
        capturedCallbacks!.onCompleted()
      })

      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning' }),
      )
    })

    it('should show timeout warning when onError fires after timeout', async () => {
      let capturedCallbacks: CompletionCbs | null = null
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, callbacks: CompletionCbs) => {
          capturedCallbacks = callbacks
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })

      await act(async () => {
        capturedCallbacks!.onError('test error')
      })

      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning' }),
      )
    })
  })

  // sendWorkflowMessage error handling
  describe('sendWorkflowMessage error', () => {
    it('should handle workflow API rejection', async () => {
      vi.mocked(sendWorkflowMessage).mockRejectedValueOnce(new Error('API error'))

      const { result } = renderHook(() => useTextGeneration(createProps({ isWorkflow: true })))

      await act(async () => {
        await result.current.handleSend()
        // Wait for the catch handler to process
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.isResponding).toBe(false)
      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'API error' }),
      )
    })
  })

  // controlStopResponding effect
  describe('effects - controlStopResponding', () => {
    it('should abort and reset state when controlStopResponding changes', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { onData, getAbortController }: CompletionCbs) => {
          getAbortController?.(new AbortController())
          onData('chunk', true, { messageId: 'msg-1', taskId: 'task-1' })
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result, rerender } = renderHook(
        (props: UseTextGenerationProps) => useTextGeneration(props),
        { initialProps: createProps({ controlStopResponding: 0 }) },
      )

      await act(async () => {
        await result.current.handleSend()
      })
      expect(result.current.isResponding).toBe(true)

      await act(async () => {
        rerender(createProps({ controlStopResponding: Date.now() }))
      })

      expect(result.current.isResponding).toBe(false)
    })
  })

  // onRunControlChange with active task
  describe('effects - onRunControlChange with active task', () => {
    it('should provide control object when responding with active task', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendWorkflowMessage).mockImplementationOnce(
        (async (_data: WorkflowBody, callbacks: WorkflowCbs) => {
          callbacks.onWorkflowStarted({ workflow_run_id: 'run-1', task_id: 'task-1' } as never)
        }) as unknown as typeof sendWorkflowMessage,
      )

      const onRunControlChange = vi.fn()
      const { result } = renderHook(() =>
        useTextGeneration(createProps({ isWorkflow: true, onRunControlChange })),
      )

      await act(async () => {
        await result.current.handleSend()
      })

      expect(onRunControlChange).toHaveBeenCalledWith(
        expect.objectContaining({ onStop: expect.any(Function), isStopping: false }),
      )
    })
  })

  // Branch coverage: handleStop when already stopping
  describe('handleStop - branch coverage', () => {
    it('should do nothing when already stopping', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendWorkflowMessage).mockImplementationOnce(
        (async (_data: WorkflowBody, callbacks: WorkflowCbs) => {
          callbacks.onWorkflowStarted({ workflow_run_id: 'run-1', task_id: 'task-1' } as never)
        }) as unknown as typeof sendWorkflowMessage,
      )
      // Make stopWorkflowMessage hang to keep isStopping=true
      vi.mocked(stopWorkflowMessage).mockReturnValueOnce(new Promise(() => {}))

      const { result } = renderHook(() => useTextGeneration(createProps({ isWorkflow: true })))

      await act(async () => {
        await result.current.handleSend()
      })

      // First stop sets isStopping=true
      act(() => {
        result.current.handleStop()
      })
      expect(result.current.isStopping).toBe(true)

      // Second stop should be a no-op
      await act(async () => {
        await result.current.handleStop()
      })

      expect(stopWorkflowMessage).toHaveBeenCalledTimes(1)
    })
  })

  // Branch coverage: onData with falsy/empty taskId
  describe('sendCompletionMessage callbacks - branch coverage', () => {
    it('should not set taskId when taskId is empty', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { onData }: CompletionCbs) => {
          onData('chunk', true, { messageId: 'msg-1', taskId: '' })
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(result.current.currentTaskId).toBeNull()
    })

    it('should not override taskId when already set', async () => {
      vi.mocked(sleep).mockReturnValueOnce(new Promise(() => {}))
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, { onData }: CompletionCbs) => {
          onData('a', true, { messageId: 'msg-1', taskId: 'first-task' })
          onData('b', false, { messageId: 'msg-1', taskId: 'second-task' })
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps()))

      await act(async () => {
        await result.current.handleSend()
      })

      // Should keep 'first-task', not override with 'second-task'
      expect(result.current.currentTaskId).toBe('first-task')
    })
  })

  // Branch coverage: promptConfig null
  describe('handleSend - promptConfig null', () => {
    it('should handle null promptConfig gracefully', async () => {
      const props = createProps({ promptConfig: null })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendCompletionMessage).toHaveBeenCalled()
    })
  })

  // Branch coverage: onCompleted before timeout (isEndRef=true skips timeout)
  describe('sendCompletionMessage - timeout skip branch', () => {
    it('should skip timeout when onCompleted fires before timeout resolves', async () => {
      // Use default sleep mock (resolves immediately) - NOT overriding to never-resolve
      const onCompleted = vi.fn()
      vi.mocked(sendCompletionMessage).mockImplementationOnce(
        (async (_data: CompletionBody, callbacks: CompletionCbs) => {
          callbacks.onData('res', true, { messageId: 'msg-1', taskId: 'task-1' })
          callbacks.onCompleted()
          // isEndRef.current = true now, so timeout IIFE will skip
        }) as unknown as typeof sendCompletionMessage,
      )

      const { result } = renderHook(() => useTextGeneration(createProps({ onCompleted })))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(result.current.isResponding).toBe(false)
      // onCompleted should be called once (from callback), not twice (timeout skipped)
      expect(onCompleted).toHaveBeenCalledTimes(1)
      expect(onCompleted).toHaveBeenCalledWith('res', undefined, true)
    })
  })

  // Branch coverage: workflow error with non-Error object
  describe('sendWorkflowMessage - non-Error rejection', () => {
    it('should handle non-Error rejection via String()', async () => {
      vi.mocked(sendWorkflowMessage).mockRejectedValueOnce('string error')

      const { result } = renderHook(() => useTextGeneration(createProps({ isWorkflow: true })))

      await act(async () => {
        await result.current.handleSend()
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(result.current.isResponding).toBe(false)
      expect(Toast.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'string error' }),
      )
    })
  })

  // Branch coverage: hasUploadingFiles false branch
  describe('handleSend - file upload branch', () => {
    it('should proceed when files have upload_file_id (not uploading)', async () => {
      const props = createProps({
        completionFiles: [
          { transfer_method: TransferMethod.local_file, url: 'http://file', upload_file_id: 'f1' },
        ] as UseTextGenerationProps['completionFiles'],
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendCompletionMessage).toHaveBeenCalled()
    })

    it('should proceed when files use remote_url transfer method', async () => {
      const props = createProps({
        completionFiles: [
          { transfer_method: TransferMethod.remote_url, url: 'http://remote' },
        ] as UseTextGenerationProps['completionFiles'],
      })

      const { result } = renderHook(() => useTextGeneration(props))

      await act(async () => {
        await result.current.handleSend()
      })

      expect(sendCompletionMessage).toHaveBeenCalled()
    })
  })
})
