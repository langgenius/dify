import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { useChat } from './hooks'

const { mockSseGet, mockSsePost } = vi.hoisted(() => ({
  mockSseGet: vi.fn(),
  mockSsePost: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/app/test',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '12:00 PM',
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: vi.fn(),
  }),
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({
      getAudioPlayer: vi.fn(),
    }),
  },
}))

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getProcessedFiles: (files: unknown[]) => files,
  getProcessedFilesFromResponse: (files: unknown[]) => files,
}))

vi.mock('@/service/base', () => ({
  sseGet: (...args: unknown[]) => mockSseGet(...args),
  ssePost: (...args: unknown[]) => mockSsePost(...args),
}))

type HitlTreeNode = {
  id: string
  content: string
  isAnswer: boolean
  workflow_run_id?: string
  humanInputFormDataList?: Array<{ node_id: string }>
  children?: HitlTreeNode[]
}

describe('useChat HITL regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should subscribe with include_state_snapshot when switching to sibling with pending human input', () => {
    const prevChatTree: HitlTreeNode[] = [
      {
        id: 'question-1',
        content: 'Q1',
        isAnswer: false,
        children: [
          {
            id: 'answer-1',
            content: '',
            isAnswer: true,
            workflow_run_id: 'workflow-run-1',
            humanInputFormDataList: [{ node_id: 'node-1' }],
            children: [],
          },
        ],
      },
    ]

    const { result } = renderHook(() => useChat(
      undefined,
      { inputs: {}, inputsForm: [] },
      prevChatTree as unknown as NonNullable<Parameters<typeof useChat>[2]>,
    ))

    act(() => {
      result.current.handleSwitchSibling('answer-1', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/workflow-run-1/events?include_state_snapshot=true',
      {},
      expect.any(Object),
    )
  })

  it('should open paused workflow event stream when workflow_paused event arrives in send flow', () => {
    mockSsePost.mockImplementation((_, __, otherOptions: {
      onWorkflowStarted?: (payload: { workflow_run_id: string, task_id: string, conversation_id?: string, message_id?: string }) => void
      onWorkflowPaused?: (payload: { data: { workflow_run_id: string } }) => void
    }) => {
      otherOptions.onWorkflowStarted?.({
        workflow_run_id: 'workflow-run-2',
        task_id: 'task-1',
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      })
      otherOptions.onWorkflowPaused?.({
        data: {
          workflow_run_id: 'workflow-run-2',
        },
      })
    })

    const { result } = renderHook(() => useChat(
      undefined,
      { inputs: {}, inputsForm: [] },
      [],
    ))

    act(() => {
      result.current.handleSend(
        '/chat-messages',
        {
          query: 'hello',
        },
        {},
      )
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/workflow-run-2/events',
      {},
      expect.any(Object),
    )
  })
})
