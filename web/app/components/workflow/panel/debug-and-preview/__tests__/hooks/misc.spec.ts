import type { ChatItemInTree } from '@/app/components/base/chat/types'
import { act } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { useChat } from '../../hooks'

const mockHandleRun = vi.fn()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()

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

// Run transport and inspector loading are supplied by the owning application through
// the real hooks store; useChat and its facade hooks stay mounted.
const renderHook: typeof renderWorkflowCanvasHook = (hook, options) =>
  renderWorkflowCanvasHook(hook, {
    ...options,
    hooksStoreProps: { handleRun: mockHandleRun, fetchInspectVars: mockFetchInspectVars },
  })

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
}

describe('useChat – handleSwitchSibling', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockSseGet.mockReset()
  })

  it('should call handleResume when target has workflow_run_id and pending humanInputFormData', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: unknown, callbacks: any) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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
        data: { form_id: 'form-human-n', node_id: 'human-n', form_token: 'ft-1' },
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-switch', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/wfr-switch/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ onData: expect.any(Function), onCompleted: expect.any(Function) }),
    )
  })

  it('should not call handleResume when target has no humanInputFormDataList', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: unknown, callbacks: any) => {
      sendCallbacks = callbacks
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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

  it('should search children recursively in findMessageInTree', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: unknown, callbacks: any) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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
      result.current.handleSend(
        {
          query: 'child',
          parent_message_id: 'msg-parent',
        },
        {},
      )
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
        data: { form_id: 'form-h-child', node_id: 'h-child', form_token: 'ft-c' },
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-child', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/wfr-2/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ onData: expect.any(Function), onCompleted: expect.any(Function) }),
    )
  })
})

describe('useChat – handleSubmitHumanInputForm', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockSubmitHumanInputForm.mockResolvedValue({})
  })

  it('should call submitHumanInputForm with token and data', async () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleSubmitHumanInputForm('token-123', {
        inputs: { field: 'value' },
        action: 'approve',
      })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-123', {
      inputs: { field: 'value' },
      action: 'approve',
    })
  })
})

describe('useChat – getHumanInputNodeData', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should return the custom node matching the given nodeID', () => {
    const mockNode = createNode({
      id: 'node-1',
      data: { type: BlockEnum.HumanInput, title: 'Human Input' },
    })

    const { result } = renderHook(() => useChat({}), {
      nodes: [mockNode, createNode({ id: 'node-2', data: { title: 'Other' } })],
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    const node = result.current.getHumanInputNodeData('node-1')
    expect(node).toMatchObject(mockNode)
  })

  it('should return undefined when no matching node', () => {
    const { result } = renderHook(() => useChat({}), {
      nodes: [createNode({ id: 'node-2' })],
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    const node = result.current.getHumanInputNodeData('nonexistent')
    expect(node).toBeUndefined()
  })

  it('should filter out non-custom nodes', () => {
    const customNode = createNode({
      id: 'custom-node',
      data: { type: BlockEnum.HumanInput, title: 'Human Input' },
    })
    const { result } = renderHook(() => useChat({}), {
      nodes: [createNode({ id: 'default-node', type: 'default' }), customNode],
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    expect(result.current.getHumanInputNodeData('default-node')).toBeUndefined()
    expect(result.current.getHumanInputNodeData('custom-node')).toMatchObject(customNode)
  })
})

describe('useChat – conversationId and setTargetMessageId', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
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

    const { result } = renderHook(() => useChat({}, undefined, prevChatTree), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.setTargetMessageId('a2-branch-a')
    })

    expect(result.current.chatList.map((item) => item.id)).toEqual([
      'q1',
      'a1',
      'q2-branch-a',
      'a2-branch-a',
    ])

    act(() => {
      result.current.setTargetMessageId('a2-branch-b')
    })

    expect(result.current.chatList.map((item) => item.id)).toEqual([
      'q1',
      'a1',
      'q2-branch-b',
      'a2-branch-b',
    ])
  })
})

describe('useChat – updateCurrentQAOnTree with parent_message_id', () => {
  let capturedCallbacks: any

  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockHandleRun.mockImplementation((_params: unknown, callbacks: any) => {
      capturedCallbacks = callbacks
    })
  })

  it('should handle follow-up message with parent_message_id', async () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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
      result.current.handleSend(
        {
          query: 'follow up',
          parent_message_id: 'msg-1',
        },
        {},
      )
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(2)
    expect(mockHandleRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'follow up', parent_message_id: 'msg-1' }),
      expect.any(Object),
    )
    act(() => {
      capturedCallbacks.onData('answer2', true, {
        conversationId: 'c1',
        messageId: 'msg-2',
        taskId: 't2',
      })
    })
    expect(result.current.conversationId).toBe('c1')
    expect(result.current.chatList.map(({ id, content }) => ({ id, content }))).toEqual([
      { id: 'question-msg-1', content: 'first' },
      { id: 'msg-1', content: 'answer1' },
      { id: 'question-msg-2', content: 'follow up' },
      { id: 'msg-2', content: 'answer2' },
    ])
  })
})
