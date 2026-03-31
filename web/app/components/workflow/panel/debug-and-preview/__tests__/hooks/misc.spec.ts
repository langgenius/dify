/* eslint-disable ts/no-explicit-any */
import type { ChatItemInTree } from '@/app/components/base/chat/types'
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

describe('useChat – handleSwitchSibling', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockSseGet.mockReset()
  })

  it('should call handleResume when target has workflow_run_id and pending humanInputFormData', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-switch',
        task_id: 'task-1',
        conversation_id: null,
        message_id: 'msg-switch',
      })
    })

    act(() => {
      sendCallbacks.onHumanInputRequired({
        data: { node_id: 'human-n', form_token: 'ft-1' },
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-switch', {})
    })

    expect(mockSseGet).toHaveBeenCalled()
  })

  it('should not call handleResume when target has no humanInputFormDataList', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-switch',
        task_id: 'task-1',
        conversation_id: null,
        message_id: 'msg-switch',
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-switch', {})
    })

    expect(mockSseGet).not.toHaveBeenCalled()
  })

  it('should return undefined from findMessageInTree when not found', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSwitchSibling('nonexistent-id', {})
    })

    expect(mockSseGet).not.toHaveBeenCalled()
  })

  it('should search children recursively in findMessageInTree', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'parent' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-1',
        task_id: 'task-1',
        conversation_id: null,
        message_id: 'msg-parent',
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSend({
        query: 'child',
        parent_message_id: 'msg-parent',
      }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-2',
        task_id: 'task-2',
        conversation_id: null,
        message_id: 'msg-child',
      })
    })

    act(() => {
      sendCallbacks.onHumanInputRequired({
        data: { node_id: 'h-child', form_token: 'ft-c' },
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-child', {})
    })

    expect(mockSseGet).toHaveBeenCalled()
  })
})

describe('useChat – handleSubmitHumanInputForm', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockSubmitHumanInputForm.mockResolvedValue({})
  })

  it('should call submitHumanInputForm with token and data', async () => {
    const { result } = renderHook(() => useChat({}))

    await act(async () => {
      await result.current.handleSubmitHumanInputForm('token-123', { field: 'value' })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-123', { field: 'value' })
  })
})

describe('useChat – getHumanInputNodeData', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockGetNodes.mockReturnValue([])
  })

  it('should return the custom node matching the given nodeID', () => {
    const mockNode = { id: 'node-1', type: 'custom', data: { title: 'Human Input' } }
    mockGetNodes.mockReturnValue([
      mockNode,
      { id: 'node-2', type: 'custom', data: { title: 'Other' } },
    ])

    const { result } = renderHook(() => useChat({}))
    const node = result.current.getHumanInputNodeData('node-1')
    expect(node).toEqual(mockNode)
  })

  it('should return undefined when no matching node', () => {
    mockGetNodes.mockReturnValue([{ id: 'node-2', type: 'custom', data: {} }])

    const { result } = renderHook(() => useChat({}))
    const node = result.current.getHumanInputNodeData('nonexistent')
    expect(node).toBeUndefined()
  })

  it('should filter out non-custom nodes', () => {
    mockGetNodes.mockReturnValue([
      { id: 'node-1', type: 'default', data: {} },
      { id: 'node-1', type: 'custom', data: { found: true } },
    ])

    const { result } = renderHook(() => useChat({}))
    const node = result.current.getHumanInputNodeData('node-1')
    expect(node).toEqual({ id: 'node-1', type: 'custom', data: { found: true } })
  })
})

describe('useChat – conversationId and setTargetMessageId', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should initially be an empty string', () => {
    const { result } = renderHook(() => useChat({}))
    expect(result.current.conversationId).toBe('')
  })

  it('setTargetMessageId should change chatList thread path', () => {
    const prevChatTree: ChatItemInTree[] = [
      {
        id: 'q1',
        content: 'question 1',
        isAnswer: false,
        children: [
          {
            id: 'a1',
            content: 'answer 1',
            isAnswer: true,
            children: [
              {
                id: 'q2-branch-a',
                content: 'branch A question',
                isAnswer: false,
                children: [
                  { id: 'a2-branch-a', content: 'branch A answer', isAnswer: true, children: [] },
                ],
              },
              {
                id: 'q2-branch-b',
                content: 'branch B question',
                isAnswer: false,
                children: [
                  { id: 'a2-branch-b', content: 'branch B answer', isAnswer: true, children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]

    const { result } = renderHook(() => useChat({}, undefined, prevChatTree))

    const defaultList = result.current.chatList
    expect(defaultList.some(item => item.id === 'a1')).toBe(true)

    act(() => {
      result.current.setTargetMessageId('a2-branch-a')
    })

    const listA = result.current.chatList
    expect(listA.some(item => item.id === 'a2-branch-a')).toBe(true)
    expect(listA.some(item => item.id === 'a2-branch-b')).toBe(false)

    act(() => {
      result.current.setTargetMessageId('a2-branch-b')
    })

    const listB = result.current.chatList
    expect(listB.some(item => item.id === 'a2-branch-b')).toBe(true)
    expect(listB.some(item => item.id === 'a2-branch-a')).toBe(false)
  })
})

describe('useChat – updateCurrentQAOnTree with parent_message_id', () => {
  let capturedCallbacks: any

  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      capturedCallbacks = callbacks
    })
  })

  it('should handle follow-up message with parent_message_id', async () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    const firstCallbacks = capturedCallbacks

    act(() => {
      firstCallbacks.onData('answer1', true, {
        conversationId: 'c1',
        messageId: 'msg-1',
        taskId: 't1',
      })
    })

    await act(async () => {
      await firstCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSend({
        query: 'follow up',
        parent_message_id: 'msg-1',
      }, {})
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(2)
    expect(result.current.chatList.length).toBeGreaterThan(0)
  })
})
