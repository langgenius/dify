import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { AppSourceType } from '@/service/share'
import GenerationItem from '../index'

const mockActionBar = vi.fn()
const mockUseGenerationItem = vi.fn()

vi.mock('@/app/components/base/loading', () => ({
  default: ({ type }: { type?: string }) => <div>{`loading:${type || 'default'}`}</div>,
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{`markdown:${content}`}</div>,
}))

vi.mock('../action-bar', () => ({
  default: (props: Record<string, unknown>) => {
    mockActionBar(props)
    return <div>{`action-bar:${String(props.messageId)}`}</div>
  },
}))

vi.mock('../workflow-content', () => ({
  default: ({
    currentTab,
    taskId,
  }: {
    currentTab: string
    taskId?: string
  }) => <div>{`workflow-content:${currentTab}:${taskId || ''}`}</div>,
}))

vi.mock('../use-generation-item', () => ({
  useGenerationItem: (...args: unknown[]) => mockUseGenerationItem(...args),
}))

const createWorkflowProcessData = (overrides: Partial<WorkflowProcess> = {}): WorkflowProcess => ({
  status: WorkflowRunningStatus.Succeeded,
  tracing: [],
  ...overrides,
})

const createHookState = (overrides: Record<string, unknown> = {}) => ({
  childMessageId: null,
  childProps: {
    appSourceType: AppSourceType.webApp,
    content: 'child content',
    depth: 2,
    isError: false,
    onRetry: vi.fn(),
    siteInfo: null,
  },
  config: {
    text_to_speech: {
      voice: 'alloy',
    },
  },
  completionRes: '',
  currentTab: 'RESULT',
  handleCopy: vi.fn(),
  handleMoreLikeThis: vi.fn(),
  handleOpenLogModal: vi.fn(),
  handleSubmitHumanInputForm: vi.fn(),
  isQuerying: false,
  isTop: true,
  isTryApp: false,
  setCurrentTab: vi.fn(),
  showChildItem: false,
  taskLabel: 'task-1',
  ...overrides,
})

const createProps = (overrides: Partial<React.ComponentProps<typeof GenerationItem>> = {}): React.ComponentProps<typeof GenerationItem> => ({
  appSourceType: AppSourceType.webApp,
  content: 'Hello world',
  feedback: { rating: null } as FeedbackType,
  isError: false,
  isLoading: false,
  isMobile: false,
  isWorkflow: false,
  messageId: 'message-1',
  onFeedback: vi.fn(),
  onRetry: vi.fn(),
  onSave: vi.fn(),
  siteInfo: null,
  taskId: 'task-1',
  ...overrides,
})

describe('GenerationItem', () => {
  it('should render the loading state while waiting for a response', () => {
    mockUseGenerationItem.mockReturnValue(createHookState())

    render(<GenerationItem {...createProps({ isLoading: true })} />)

    expect(screen.getByText('loading:area')).toBeInTheDocument()
    expect(screen.queryByText(/action-bar:/)).not.toBeInTheDocument()
  })

  it('should render workflow content and pass the derived action-bar props', () => {
    mockUseGenerationItem.mockReturnValue(createHookState({
      currentTab: 'DETAIL',
    }))

    render(
      <GenerationItem
        {...createProps({
          content: { raw: true },
          isWorkflow: true,
          taskId: 'task-9',
          workflowProcessData: createWorkflowProcessData({
            resultText: 'done',
          }),
        })}
      />,
    )

    expect(screen.getByText('workflow-content:DETAIL:task-9')).toBeInTheDocument()
    expect(screen.queryByText(/common\.unit\.char/)).not.toBeInTheDocument()
    expect(mockActionBar.mock.calls[0][0]).toEqual(expect.objectContaining({
      currentTab: 'DETAIL',
      isWorkflow: true,
      messageId: 'message-1',
      voice: 'alloy',
    }))
  })

  it('should render markdown output, task header, char count, and nested child items', () => {
    mockUseGenerationItem
      .mockReturnValueOnce(createHookState({
        childProps: createProps({
          content: 'Child answer',
          depth: 2,
          messageId: 'child-1',
        }),
        showChildItem: true,
      }))
      .mockReturnValueOnce(createHookState({
        childProps: createProps({
          content: '',
          depth: 3,
          messageId: 'child-2',
        }),
        isTop: false,
        showChildItem: false,
        taskLabel: 'task-1-1',
      }))

    render(<GenerationItem {...createProps({ isMobile: true, taskId: 'task-1' })} />)

    expect(screen.getAllByText('share.generation.execution')).toHaveLength(2)
    expect(screen.getByText('task-1')).toBeInTheDocument()
    expect(screen.getByText('markdown:Hello world')).toBeInTheDocument()
    expect(screen.getByText(/11\s+common\.unit\.char/)).toBeInTheDocument()
    expect(screen.getByText('markdown:Child answer')).toBeInTheDocument()
    expect(screen.getAllByText(/action-bar:/)).toHaveLength(2)
  })
})
