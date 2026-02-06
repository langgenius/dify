import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkflowRunningStatus } from '../../../types'
import { useChatMessageSender } from './use-chat-message-sender'

const {
  mockSseGet,
  mockSubmitHumanInputForm,
  mockHandleRun,
  mockFetchInspectVars,
  mockInvalidAllLastRun,
  mockInvalidateSandboxFiles,
} = vi.hoisted(() => ({
  mockSseGet: vi.fn(),
  mockSubmitHumanInputForm: vi.fn(),
  mockHandleRun: vi.fn(),
  mockFetchInspectVars: vi.fn(),
  mockInvalidAllLastRun: vi.fn(),
  mockInvalidateSandboxFiles: vi.fn(),
}))

type ChatTreeNode = {
  id: string
  children?: ChatTreeNode[]
  workflowProcess?: {
    status: WorkflowRunningStatus
    tracing: unknown[]
  }
  [key: string]: unknown
}

type ChatPreviewStoreState = {
  chatTree: ChatTreeNode[]
  updateChatTree: (updater: (current: ChatTreeNode[]) => ChatTreeNode[]) => void
  setConversationId: ReturnType<typeof vi.fn>
  setTargetMessageId: ReturnType<typeof vi.fn>
  setSuggestedQuestions: ReturnType<typeof vi.fn>
  setActiveTaskId: ReturnType<typeof vi.fn>
  setHasStopResponded: ReturnType<typeof vi.fn>
  setSuggestedQuestionsAbortController: ReturnType<typeof vi.fn>
  setWorkflowEventsAbortController: ReturnType<typeof vi.fn>
  startRun: ReturnType<typeof vi.fn>
}

const mockStoreState: ChatPreviewStoreState = {
  chatTree: [],
  updateChatTree: () => {},
  setConversationId: vi.fn(),
  setTargetMessageId: vi.fn(),
  setSuggestedQuestions: vi.fn(),
  setActiveTaskId: vi.fn(),
  setHasStopResponded: vi.fn(),
  setSuggestedQuestionsAbortController: vi.fn(),
  setWorkflowEventsAbortController: vi.fn(),
  startRun: vi.fn(() => 1),
}

const mockWorkflowStore = {
  getState: vi.fn(() => ({
    isResponding: false,
    activeRunId: 1,
    suggestedQuestionsAbortController: null,
    workflowEventsAbortController: null as AbortController | null,
    workflowRunningData: {
      result: {
        status: WorkflowRunningStatus.Running,
      },
    },
    hasStopResponded: false,
  })),
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: vi.fn(),
  }),
}))

vi.mock('@/service/base', () => ({
  sseGet: (...args: unknown[]) => mockSseGet(...args),
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/use-sandbox-file', () => ({
  useInvalidateSandboxFiles: () => mockInvalidateSandboxFiles,
}))

vi.mock('../../../hooks', () => ({
  useWorkflowRun: () => ({
    handleRun: mockHandleRun,
  }),
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: mockFetchInspectVars,
  }),
}))

vi.mock('../../../hooks-store', () => ({
  useHooksStore: () => ({
    configsMap: {
      flowType: 'workflow',
      flowId: 'flow-1',
    },
  }),
}))

vi.mock('../../../store', () => ({
  useStore: (selector: (state: ChatPreviewStoreState) => unknown) => selector(mockStoreState),
  useWorkflowStore: () => mockWorkflowStore,
}))

describe('useChatMessageSender HITL regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.chatTree = [
      {
        id: 'question-1',
        isAnswer: false,
        children: [
          {
            id: 'answer-1',
            isAnswer: true,
            content: '',
            workflowProcess: {
              status: WorkflowRunningStatus.Running,
              tracing: [],
            },
            children: [],
          },
        ],
      },
    ]
    mockStoreState.updateChatTree = (updater) => {
      mockStoreState.chatTree = updater(mockStoreState.chatTree)
    }
    mockSseGet.mockImplementation(() => undefined)
    mockWorkflowStore.getState.mockReturnValue({
      isResponding: false,
      activeRunId: 1,
      suggestedQuestionsAbortController: null,
      workflowEventsAbortController: null,
      workflowRunningData: {
        result: {
          status: WorkflowRunningStatus.Running,
        },
      },
      hasStopResponded: false,
    })
  })

  it('should subscribe with include_state_snapshot and re-subscribe on workflow paused event', () => {
    let callCount = 0
    mockSseGet.mockImplementation((url: string, _params: unknown, otherOptions: {
      getAbortController?: (abortController: AbortController) => void
      onWorkflowPaused?: (event: { data: { workflow_run_id: string } }) => void
    }) => {
      callCount += 1
      otherOptions.getAbortController?.(new AbortController())
      if (callCount === 1) {
        otherOptions.onWorkflowPaused?.({
          data: {
            workflow_run_id: 'workflow-run-2',
          },
        })
      }
      return undefined
    })

    const { result } = renderHook(() => useChatMessageSender({
      threadMessages: [],
      config: undefined,
      formSettings: undefined,
      handleResponding: vi.fn(),
      updateCurrentQAOnTree: vi.fn(),
    }))

    act(() => {
      result.current.handleResume('answer-1', 'workflow-run-1', {})
    })

    expect(mockSseGet).toHaveBeenNthCalledWith(
      1,
      '/workflow/workflow-run-1/events?include_state_snapshot=true',
      {},
      expect.any(Object),
    )
    expect(mockSseGet).toHaveBeenNthCalledWith(
      2,
      '/workflow/workflow-run-2/events',
      {},
      expect.any(Object),
    )
  })

  it('should forward human input form submission to workflow service', async () => {
    const { result } = renderHook(() => useChatMessageSender({
      threadMessages: [],
      config: undefined,
      formSettings: undefined,
      handleResponding: vi.fn(),
      updateCurrentQAOnTree: vi.fn(),
    }))

    await act(async () => {
      await result.current.handleSubmitHumanInputForm('form-token-1', {
        inputs: { foo: 'bar' },
        action: 'submit',
      })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('form-token-1', {
      inputs: { foo: 'bar' },
      action: 'submit',
    })
  })
})
