import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { CUSTOM_NODE } from '../../../constants'
import { useChat } from './use-chat'

const {
  mockHandleSend,
  mockHandleResume,
  mockHandleSubmitHumanInputForm,
  mockGetNodes,
} = vi.hoisted(() => ({
  mockHandleSend: vi.fn(),
  mockHandleResume: vi.fn(),
  mockHandleSubmitHumanInputForm: vi.fn(),
  mockGetNodes: vi.fn(),
}))

type ChatTreeNode = {
  id: string
  children?: ChatTreeNode[]
  workflow_run_id?: string
  humanInputFormDataList?: Array<{ node_id: string }>
  [key: string]: unknown
}

type StoreState = {
  chatTree: ChatTreeNode[]
  conversationId: string
  isResponding: boolean
  suggestedQuestions: string[]
  targetMessageId?: string
  updateChatTree: (updater: (current: ChatTreeNode[]) => ChatTreeNode[]) => void
  setTargetMessageId: ReturnType<typeof vi.fn>
}

const mockStoreState: StoreState = {
  chatTree: [],
  conversationId: 'conversation-1',
  isResponding: false,
  suggestedQuestions: [],
  targetMessageId: undefined,
  updateChatTree: () => {},
  setTargetMessageId: vi.fn(),
}

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('../../../store', () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(mockStoreState),
}))

vi.mock('./use-chat-flow-control', () => ({
  useChatFlowControl: () => ({
    handleResponding: vi.fn(),
    handleStop: vi.fn(),
    handleRestart: vi.fn(),
  }),
}))

vi.mock('./use-chat-list', () => ({
  useChatList: () => ({
    threadMessages: [],
    chatList: [],
  }),
}))

vi.mock('./use-chat-tree-operations', () => ({
  useChatTreeOperations: () => ({
    updateCurrentQAOnTree: vi.fn(),
  }),
}))

vi.mock('./use-chat-message-sender', () => ({
  useChatMessageSender: () => ({
    handleSend: mockHandleSend,
    handleResume: mockHandleResume,
    handleSubmitHumanInputForm: mockHandleSubmitHumanInputForm,
  }),
}))

describe('useChat (debug-and-preview)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.chatTree = []
    mockStoreState.conversationId = 'conversation-1'
    mockStoreState.isResponding = false
    mockStoreState.suggestedQuestions = []
    mockStoreState.targetMessageId = undefined
    mockGetNodes.mockReturnValue([
      { id: 'custom-node-1', type: CUSTOM_NODE, data: { title: 'Node 1' } },
      { id: 'other-node-1', type: 'input', data: { title: 'Input' } },
    ])
  })

  it('should call handleResume when switching to sibling with pending human input form', () => {
    mockStoreState.chatTree = [
      {
        id: 'question-1',
        isAnswer: false,
        children: [
          {
            id: 'answer-1',
            isAnswer: true,
            workflow_run_id: 'workflow-run-1',
            humanInputFormDataList: [{ node_id: 'node-1' }],
            children: [],
          },
        ],
      },
    ]

    const { result } = renderHook(() => useChat(undefined, undefined))

    const callbacks = { onGetSuggestedQuestions: vi.fn() }
    act(() => {
      result.current.handleSwitchSibling('answer-1', callbacks)
    })

    expect(mockStoreState.setTargetMessageId).toHaveBeenCalledWith('answer-1')
    expect(mockHandleResume).toHaveBeenCalledWith('answer-1', 'workflow-run-1', callbacks)
  })

  it('should expose getHumanInputNodeData from reactflow nodes', () => {
    const { result } = renderHook(() => useChat(undefined, undefined))

    const node = result.current.getHumanInputNodeData('custom-node-1')

    expect(node).toEqual({ id: 'custom-node-1', type: CUSTOM_NODE, data: { title: 'Node 1' } })
  })
})
