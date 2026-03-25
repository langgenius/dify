/* eslint-disable ts/no-explicit-any */
import { act, renderHook } from '@testing-library/react'
import { useChat } from '../../hooks'

const mockHandleRun = vi.fn()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSetIterTimes = vi.fn()
const mockSetLoopTimes = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()
const mockStopChat = vi.fn()
const mockGetNodes = vi.fn((): any[] => [])

let mockWorkflowRunningData: any = null

vi.mock('@/service/base', () => ({
  sseGet: (...args: any[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: any[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: (...args: any[]) => mockNotify(...args),
  },
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('../../../../hooks', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
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
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleStop()
    })
    expect(result.current.isResponding).toBe(false)
  })

  it('should not call stopChat when taskId is empty even if stopChat is provided', () => {
    const { result } = renderHook(() => useChat({}, undefined, undefined, mockStopChat))
    act(() => {
      result.current.handleStop()
    })
    expect(mockStopChat).not.toHaveBeenCalled()
  })

  it('should reset iter/loop times to defaults', () => {
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleStop()
    })
    expect(mockSetIterTimes).toHaveBeenCalledWith(1)
    expect(mockSetLoopTimes).toHaveBeenCalledWith(1)
  })

  it('should abort workflowEventsAbortController when set', () => {
    const mockWfAbort = vi.fn()
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.getAbortController({ abort: mockWfAbort } as any)
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockWfAbort).toHaveBeenCalledTimes(1)
  })

  it('should abort suggestedQuestionsAbortController when set', async () => {
    const mockSqAbort = vi.fn()
    let capturedCb: any

    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      capturedCb = callbacks
    })

    const mockGetSuggested = vi.fn().mockImplementation((_id: string, getAbortCtrl: any) => {
      getAbortCtrl({ abort: mockSqAbort } as any)
      return Promise.resolve({ data: ['s'] })
    })

    const { result } = renderHook(() =>
      useChat({ suggested_questions_after_answer: { enabled: true } }),
    )

    act(() => {
      result.current.handleSend({ query: 'test' }, {
        onGetSuggestedQuestions: mockGetSuggested,
      })
    })

    await act(async () => {
      await capturedCb.onCompleted(false)
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockSqAbort).toHaveBeenCalledTimes(1)
  })

  it('should call stopChat with taskId when both are available', () => {
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.onData('msg', true, {
        conversationId: 'c1',
        messageId: 'msg-1',
        taskId: 'task-stop',
      })
    })

    const { result } = renderHook(() => useChat({}, undefined, undefined, mockStopChat))

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
    const { result } = renderHook(() => useChat(config))

    act(() => {
      result.current.handleRestart()
    })

    expect(result.current.suggestedQuestions).toEqual([])
    expect(result.current.isResponding).toBe(false)
  })

  it('should reset iter/loop times to defaults', () => {
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleRestart()
    })
    expect(mockSetIterTimes).toHaveBeenCalledWith(1)
    expect(mockSetLoopTimes).toHaveBeenCalledWith(1)
  })
})
