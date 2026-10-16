import type { useWorkflowRun } from '@/app/components/workflow/hooks/use-workflow-run'
import { act } from '@testing-library/react'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { useChat } from '../../hooks'

type WorkflowRunCallbacks = NonNullable<
  Parameters<ReturnType<typeof useWorkflowRun>['handleRun']>[1]
>

const mockHandleRun = vi.fn()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSetIterTimes = vi.fn()
const mockSetLoopTimes = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()
const mockStopChat = vi.fn()
const mockGetNodes = vi.fn((): { id: string; type: string; data: Record<string, unknown> }[] => [])

let mockWorkflowRunningData: { result: { status: string } } | null = null

vi.mock('@/service/base', () => ({
  sseGet: (...args: unknown[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: (...args: unknown[]) => mockNotify(...args),
  },
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('../../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
}))

vi.mock('../../../../hooks/use-set-workflow-vars-with-value', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

vi.mock('../../../../hooks-store', () => ({
  useHooksStore: () => null,
}))

vi.mock('../../../../store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setIterTimes: mockSetIterTimes,
      setLoopTimes: mockSetLoopTimes,
      inputs: {},
      workflowRunningData: mockWorkflowRunningData,
    }),
  }),
  useStore: () => vi.fn(),
}))

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
  mockWorkflowRunningData = null
}

describe('useChat – handleStop', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should set isResponding to false', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    act(() => {
      result.current.handleStop()
    })
    expect(result.current.isResponding).toBe(false)
  })

  it('should not call stopChat when taskId is empty even if stopChat is provided', () => {
    const { result } = renderHook(() => useChat({}, undefined, undefined, mockStopChat), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    act(() => {
      result.current.handleStop()
    })
    expect(mockStopChat).not.toHaveBeenCalled()
  })

  it('should reset iter/loop times to defaults', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    act(() => {
      result.current.handleStop()
    })
    expect(mockSetIterTimes).toHaveBeenCalledWith(1)
    expect(mockSetLoopTimes).toHaveBeenCalledWith(1)
  })

  it('should abort workflowEventsAbortController when set', () => {
    const controller = new AbortController()
    const mockWfAbort = vi.spyOn(controller, 'abort')
    mockHandleRun.mockImplementation((_params: unknown, callbacks: WorkflowRunCallbacks) => {
      callbacks.getAbortController!(controller)
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockWfAbort).toHaveBeenCalledTimes(1)
  })

  it('should cancel the suggested questions request when stopped', async () => {
    const mockSqAbort = vi.fn()
    let capturedCb: WorkflowRunCallbacks

    mockHandleRun.mockImplementation((_params: unknown, callbacks: WorkflowRunCallbacks) => {
      capturedCb = callbacks
    })

    const mockGetSuggested = vi
      .fn()
      .mockImplementation((_id: string, onCancel: (cancel: () => void) => void) => {
        onCancel(mockSqAbort)
        return Promise.resolve({ data: ['s'] })
      })

    const { result } = renderHook(
      () => useChat({ suggested_questions_after_answer: { enabled: true } }),
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    act(() => {
      result.current.handleSend(
        { query: 'test' },
        {
          onGetSuggestedQuestions: mockGetSuggested,
        },
      )
    })

    await act(async () => {
      await capturedCb.onCompleted!(false)
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockSqAbort).toHaveBeenCalledTimes(1)
  })

  it('should call stopChat with taskId when both are available', () => {
    mockHandleRun.mockImplementation((_params: unknown, callbacks: WorkflowRunCallbacks) => {
      callbacks.onData!('msg', true, {
        conversationId: 'c1',
        messageId: 'msg-1',
        taskId: 'task-stop',
      })
    })

    const { result } = renderHook(() => useChat({}, undefined, undefined, mockStopChat), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockStopChat).toHaveBeenCalledWith('task-stop')
  })
})

describe('useChat – handleRestart', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should clear suggestedQuestions and set isResponding to false', () => {
    const config = { opening_statement: 'Hello' }
    const { result } = renderHook(() => useChat(config), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleRestart()
    })

    expect(result.current.suggestedQuestions).toEqual([])
    expect(result.current.isResponding).toBe(false)
  })

  it('should reset iter/loop times to defaults', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    act(() => {
      result.current.handleRestart()
    })
    expect(mockSetIterTimes).toHaveBeenCalledWith(1)
    expect(mockSetLoopTimes).toHaveBeenCalledWith(1)
  })
})
