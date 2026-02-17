import type { PropsWithChildren, ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

import RagPipelineHeader from '../index'
import InputFieldButton from '../input-field-button'
import Publisher from '../publisher'
import Popup from '../publisher/popup'
import RunMode from '../run-mode'

const mockSetShowInputFieldPanel = vi.fn()
const mockSetShowEnvPanel = vi.fn()
const mockSetIsPreparingDataSource = vi.fn()
const mockSetShowDebugAndPreviewPanel = vi.fn()
const mockSetPublishedAt = vi.fn()

let mockStoreState = {
  pipelineId: 'test-pipeline-id',
  showDebugAndPreviewPanel: false,
  publishedAt: 0,
  draftUpdatedAt: Date.now(),
  workflowRunningData: null as null | {
    task_id: string
    result: { status: WorkflowRunningStatus }
  },
  isPreparingDataSource: false,
  setShowInputFieldPanel: mockSetShowInputFieldPanel,
  setShowEnvPanel: mockSetShowEnvPanel,
}

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
  useWorkflowStore: () => ({
    getState: () => ({
      setShowInputFieldPanel: mockSetShowInputFieldPanel,
      setShowEnvPanel: mockSetShowEnvPanel,
      setIsPreparingDataSource: mockSetIsPreparingDataSource,
      setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      setPublishedAt: mockSetPublishedAt,
    }),
  }),
}))

const mockHandleSyncWorkflowDraft = vi.fn()
const mockHandleCheckBeforePublish = vi.fn().mockResolvedValue(true)
const mockHandleStopRun = vi.fn()
const mockHandleWorkflowStartRunInWorkflow = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
  useWorkflowRun: () => ({
    handleStopRun: mockHandleStopRun,
  }),
  useWorkflowStartRun: () => ({
    handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
  }),
}))

vi.mock('@/app/components/workflow/header', () => ({
  default: ({ normal, viewHistory }: {
    normal?: { components?: { left?: ReactNode, middle?: ReactNode }, runAndHistoryProps?: unknown }
    viewHistory?: { viewHistoryProps?: unknown }
  }) => (
    <div data-testid="workflow-header">
      <div data-testid="header-left">{normal?.components?.left}</div>
      <div data-testid="header-middle">{normal?.components?.middle}</div>
      <div data-testid="header-run-and-history">{JSON.stringify(normal?.runAndHistoryProps)}</div>
      <div data-testid="header-view-history">{JSON.stringify(viewHistory?.viewHistoryProps)}</div>
    </div>
  ),
}))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'test-dataset-id' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const mockPublishWorkflow = vi.fn().mockResolvedValue({ created_at: Date.now() })
const mockPublishAsCustomizedPipeline = vi.fn().mockResolvedValue({})

vi.mock('@/service/use-workflow', () => ({
  usePublishWorkflow: () => ({
    mutateAsync: mockPublishWorkflow,
  }),
}))

vi.mock('@/service/use-pipeline', () => ({
  publishedPipelineInfoQueryKeyPrefix: ['pipeline-info'],
  useInvalidCustomizedTemplateList: () => vi.fn(),
  usePublishAsCustomizedPipeline: () => ({
    mutateAsync: mockPublishAsCustomizedPipeline,
  }),
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: () => vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => vi.fn(),
}))

const mockMutateDatasetRes = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: () => mockMutateDatasetRes,
}))

const mockSetShowPricingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: () => mockSetShowPricingModal,
}))

let mockProviderContextValue = createMockProviderContextValue()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderContextValue,
  useProviderContextSelector: <T,>(selector: (s: ReturnType<typeof createMockProviderContextValue>) => T): T =>
    selector(mockProviderContextValue),
}))

const mockEventEmitter = {
  useSubscription: vi.fn(),
}
let mockEventEmitterEnabled = true
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: mockEventEmitterEnabled ? mockEventEmitter : undefined,
  }),
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => '/api/docs',
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (ts: number) => `${Math.floor((Date.now() - ts) / 1000)} seconds ago`,
  }),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  getKeyboardKeyCodeBySystem: (key: string) => key,
  getKeyboardKeyNameBySystem: (key: string) => key,
}))

vi.mock('ahooks', () => ({
  useBoolean: (initial: boolean) => {
    let value = initial
    return [
      value,
      {
        setTrue: vi.fn(() => { value = true }),
        setFalse: vi.fn(() => { value = false }),
        toggle: vi.fn(() => { value = !value }),
      },
    ]
  },
  useKeyPress: vi.fn(),
}))

let portalOpenState = false
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open, onOpenChange: _onOpenChange }: PropsWithChildren<{
    open: boolean
    onOpenChange: (open: boolean) => void
    placement?: string
    offset?: unknown
  }>) => {
    portalOpenState = open
    return <div data-testid="portal-elem" data-open={open}>{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: PropsWithChildren) => {
    if (!portalOpenState)
      return null
    return <div data-testid="portal-content">{children}</div>
  },
}))

vi.mock('../../../publish-as-knowledge-pipeline-modal', () => ({
  default: ({ onConfirm, onCancel }: {
    onConfirm: (name: string, icon: unknown, description?: string) => void
    onCancel: () => void
    confirmDisabled?: boolean
  }) => (
    <div data-testid="publish-as-pipeline-modal">
      <button data-testid="modal-confirm" onClick={() => onConfirm('test-name', { type: 'emoji', emoji: '📦' }, 'test-description')}>Confirm</button>
      <button data-testid="modal-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

describe('RagPipelineHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpenState = false
    mockStoreState = {
      pipelineId: 'test-pipeline-id',
      showDebugAndPreviewPanel: false,
      publishedAt: 0,
      draftUpdatedAt: Date.now(),
      workflowRunningData: null,
      isPreparingDataSource: false,
      setShowInputFieldPanel: mockSetShowInputFieldPanel,
      setShowEnvPanel: mockSetShowEnvPanel,
    }
    mockProviderContextValue = createMockProviderContextValue()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<RagPipelineHeader />)
      expect(screen.getByTestId('workflow-header')).toBeInTheDocument()
    })

    it('should render InputFieldButton in left slot', () => {
      render(<RagPipelineHeader />)
      expect(screen.getByTestId('header-left')).toBeInTheDocument()
      expect(screen.getByText(/inputField/i)).toBeInTheDocument()
    })

    it('should render Publisher in middle slot', () => {
      render(<RagPipelineHeader />)
      expect(screen.getByTestId('header-middle')).toBeInTheDocument()
    })

    it('should pass correct viewHistoryProps with pipelineId', () => {
      render(<RagPipelineHeader />)
      const viewHistoryContent = screen.getByTestId('header-view-history').textContent
      expect(viewHistoryContent).toContain('/rag/pipelines/test-pipeline-id/workflow-runs')
    })
  })

  describe('Memoization', () => {
    it('should compute viewHistoryProps based on pipelineId', () => {
      mockStoreState.pipelineId = 'pipeline-alpha'
      const { unmount } = render(<RagPipelineHeader />)
      let viewHistoryContent = screen.getByTestId('header-view-history').textContent
      expect(viewHistoryContent).toContain('pipeline-alpha')
      unmount()

      mockStoreState.pipelineId = 'pipeline-beta'
      render(<RagPipelineHeader />)
      viewHistoryContent = screen.getByTestId('header-view-history').textContent
      expect(viewHistoryContent).toContain('pipeline-beta')
    })

    it('should include showRunButton in runAndHistoryProps', () => {
      render(<RagPipelineHeader />)
      const runAndHistoryContent = screen.getByTestId('header-run-and-history').textContent
      expect(runAndHistoryContent).toContain('"showRunButton":true')
    })
  })
})

describe('InputFieldButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.setShowInputFieldPanel = mockSetShowInputFieldPanel
    mockStoreState.setShowEnvPanel = mockSetShowEnvPanel
  })

  describe('Rendering', () => {
    it('should render button with correct text', () => {
      render(<InputFieldButton />)
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/inputField/i)).toBeInTheDocument()
    })

    it('should render with secondary variant style', () => {
      render(<InputFieldButton />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex', 'gap-x-0.5')
    })
  })

  describe('Event Handlers', () => {
    it('should call setShowInputFieldPanel(true) when clicked', () => {
      render(<InputFieldButton />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockSetShowInputFieldPanel).toHaveBeenCalledWith(true)
    })

    it('should call setShowEnvPanel(false) when clicked', () => {
      render(<InputFieldButton />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    })

    it('should call both store methods in sequence when clicked', () => {
      render(<InputFieldButton />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockSetShowInputFieldPanel).toHaveBeenCalledTimes(1)
      expect(mockSetShowEnvPanel).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined setShowInputFieldPanel gracefully', () => {
      mockStoreState.setShowInputFieldPanel = undefined as unknown as typeof mockSetShowInputFieldPanel

      render(<InputFieldButton />)

      expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()
    })
  })
})

describe('Publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpenState = false
  })

  describe('Rendering', () => {
    it('should render publish button', () => {
      render(<Publisher />)
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/workflow.common.publish/i)).toBeInTheDocument()
    })

    it('should render with primary variant', () => {
      render(<Publisher />)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-2')
    })

    it('should render portal trigger element', () => {
      render(<Publisher />)
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call handleSyncWorkflowDraft when opening', () => {
      render(<Publisher />)

      fireEvent.click(screen.getByTestId('portal-trigger'))

      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    })

    it('should toggle open state when trigger clicked', () => {
      render(<Publisher />)

      const portal = screen.getByTestId('portal-elem')
      expect(portal).toHaveAttribute('data-open', 'false')

      fireEvent.click(screen.getByTestId('portal-trigger'))

      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalled()
    })
  })
})

describe('Popup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.publishedAt = 0
    mockStoreState.draftUpdatedAt = Date.now()
    mockStoreState.pipelineId = 'test-pipeline-id'
    mockProviderContextValue = createMockProviderContextValue({
      isAllowPublishAsCustomKnowledgePipelineTemplate: true,
    })
  })

  describe('Rendering', () => {
    it('should render popup container', () => {
      render(<Popup />)
      expect(screen.getByText(/workflow.common.publishUpdate/i)).toBeInTheDocument()
    })

    it('should show unpublished state when publishedAt is 0', () => {
      mockStoreState.publishedAt = 0

      render(<Popup />)

      expect(screen.getByText(/workflow.common.currentDraftUnpublished/i)).toBeInTheDocument()
    })

    it('should show published state when publishedAt is set', () => {
      mockStoreState.publishedAt = Date.now() - 60000

      render(<Popup />)

      expect(screen.getByText(/workflow.common.latestPublished/i)).toBeInTheDocument()
    })

    it('should render keyboard shortcuts', () => {
      render(<Popup />)

      expect(screen.getByText('ctrl')).toBeInTheDocument()
      expect(screen.getByText('⇧')).toBeInTheDocument()
      expect(screen.getByText('P')).toBeInTheDocument()
    })

    it('should render goToAddDocuments button', () => {
      render(<Popup />)

      expect(screen.getByText(/pipeline.common.goToAddDocuments/i)).toBeInTheDocument()
    })

    it('should render API reference link', () => {
      render(<Popup />)

      expect(screen.getByText(/workflow.common.accessAPIReference/i)).toBeInTheDocument()
    })

    it('should render publish as template button', () => {
      render(<Popup />)

      expect(screen.getByText(/pipeline.common.publishAs/i)).toBeInTheDocument()
    })
  })

  describe('Button States', () => {
    it('should disable goToAddDocuments when not published', () => {
      mockStoreState.publishedAt = 0

      render(<Popup />)

      const button = screen.getByText(/pipeline.common.goToAddDocuments/i).closest('button')
      expect(button).toBeDisabled()
    })

    it('should enable goToAddDocuments when published', () => {
      mockStoreState.publishedAt = Date.now()

      render(<Popup />)

      const button = screen.getByText(/pipeline.common.goToAddDocuments/i).closest('button')
      expect(button).not.toBeDisabled()
    })

    it('should disable publish as template when not published', () => {
      mockStoreState.publishedAt = 0

      render(<Popup />)

      const button = screen.getByText(/pipeline.common.publishAs/i).closest('button')
      expect(button).toBeDisabled()
    })
  })

  describe('Premium Badge', () => {
    it('should show premium badge when not allowed to publish as template', () => {
      mockProviderContextValue = createMockProviderContextValue({
        isAllowPublishAsCustomKnowledgePipelineTemplate: false,
      })

      render(<Popup />)

      expect(screen.getByText(/billing.upgradeBtn.encourageShort/i)).toBeInTheDocument()
    })

    it('should not show premium badge when allowed to publish as template', () => {
      mockProviderContextValue = createMockProviderContextValue({
        isAllowPublishAsCustomKnowledgePipelineTemplate: true,
      })

      render(<Popup />)

      expect(screen.queryByText(/billing.upgradeBtn.encourageShort/i)).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call handleCheckBeforePublish when publish button clicked', async () => {
      render(<Popup />)

      const publishButton = screen.getByText(/workflow.common.publishUpdate/i).closest('button')!
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(mockHandleCheckBeforePublish).toHaveBeenCalled()
      })
    })

    it('should navigate to add documents when goToAddDocuments clicked', () => {
      mockStoreState.publishedAt = Date.now()

      render(<Popup />)

      const button = screen.getByText(/pipeline.common.goToAddDocuments/i).closest('button')!
      fireEvent.click(button)

      expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/documents/create-from-pipeline')
    })

    it('should show pricing modal when clicking publish as template without permission', () => {
      mockStoreState.publishedAt = Date.now()
      mockProviderContextValue = createMockProviderContextValue({
        isAllowPublishAsCustomKnowledgePipelineTemplate: false,
      })

      render(<Popup />)

      const button = screen.getByText(/pipeline.common.publishAs/i).closest('button')!
      fireEvent.click(button)

      expect(mockSetShowPricingModal).toHaveBeenCalled()
    })
  })

  describe('Auto-save Display', () => {
    it('should show auto-saved time when not published', () => {
      mockStoreState.publishedAt = 0
      mockStoreState.draftUpdatedAt = Date.now() - 5000

      render(<Popup />)

      expect(screen.getByText(/workflow.common.autoSaved/i)).toBeInTheDocument()
    })

    it('should show published time when published', () => {
      mockStoreState.publishedAt = Date.now() - 60000

      render(<Popup />)

      expect(screen.getByText(/workflow.common.publishedAt/i)).toBeInTheDocument()
    })
  })
})

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.workflowRunningData = null
    mockStoreState.isPreparingDataSource = false
    mockEventEmitterEnabled = true
  })

  describe('Rendering', () => {
    it('should render run button with default text', () => {
      render(<RunMode />)

      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/pipeline.common.testRun/i)).toBeInTheDocument()
    })

    it('should render with custom text prop', () => {
      render(<RunMode text="Custom Run" />)

      expect(screen.getByText('Custom Run')).toBeInTheDocument()
    })

    it('should render keyboard shortcuts when not disabled', () => {
      render(<RunMode />)

      expect(screen.getByText('alt')).toBeInTheDocument()
      expect(screen.getByText('R')).toBeInTheDocument()
    })
  })

  describe('Running States', () => {
    it('should show processing state when running', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      expect(screen.getByText(/pipeline.common.processing/i)).toBeInTheDocument()
    })

    it('should show stop button when running', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2)
    })

    it('should show reRun text when workflow has run before', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Succeeded },
      }

      render(<RunMode />)

      expect(screen.getByText(/pipeline.common.reRun/i)).toBeInTheDocument()
    })

    it('should show preparing data source state', () => {
      mockStoreState.isPreparingDataSource = true

      render(<RunMode />)

      expect(screen.getByText(/pipeline.common.preparingDataSource/i)).toBeInTheDocument()
    })

    it('should show cancel button when preparing data source', () => {
      mockStoreState.isPreparingDataSource = true

      render(<RunMode />)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2)
    })

    it('should show reRun text when workflow status is Failed', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Failed },
      }

      render(<RunMode />)

      expect(screen.getByText(/pipeline.common.reRun/i)).toBeInTheDocument()
    })

    it('should show reRun text when workflow status is Stopped', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Stopped },
      }

      render(<RunMode />)

      expect(screen.getByText(/pipeline.common.reRun/i)).toBeInTheDocument()
    })

    it('should show reRun text when workflow status is Waiting', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Waiting },
      }

      render(<RunMode />)

      expect(screen.getByText(/pipeline.common.reRun/i)).toBeInTheDocument()
    })

    it('should not show stop button when status is not Running', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Succeeded },
      }

      render(<RunMode />)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(1)
    })

    it('should enable button when status is Succeeded', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Succeeded },
      }

      render(<RunMode />)

      const runButton = screen.getByRole('button')
      expect(runButton).not.toBeDisabled()
    })

    it('should enable button when status is Failed', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Failed },
      }

      render(<RunMode />)

      const runButton = screen.getByRole('button')
      expect(runButton).not.toBeDisabled()
    })
  })

  describe('Disabled States', () => {
    it('should be disabled when running', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      expect(runButton).toBeDisabled()
    })

    it('should be disabled when preparing data source', () => {
      mockStoreState.isPreparingDataSource = true

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      expect(runButton).toBeDisabled()
    })

    it('should not show keyboard shortcuts when disabled', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      expect(screen.queryByText('alt')).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call handleWorkflowStartRunInWorkflow when clicked', () => {
      render(<RunMode />)

      fireEvent.click(screen.getByRole('button'))

      expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalled()
    })

    it('should call handleStopRun when stop button clicked', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1])

      expect(mockHandleStopRun).toHaveBeenCalledWith('task-123')
    })

    it('should cancel preparing data source when cancel clicked', () => {
      mockStoreState.isPreparingDataSource = true

      render(<RunMode />)

      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1])

      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
      expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(false)
    })

    it('should call handleStopRun with empty string when task_id is undefined', () => {
      mockStoreState.workflowRunningData = {
        task_id: undefined as unknown as string,
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1]) // Click stop button

      expect(mockHandleStopRun).toHaveBeenCalledWith('')
    })

    it('should not call handleWorkflowStartRunInWorkflow when disabled', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      fireEvent.click(runButton)

      expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
    })
  })

  describe('Event Emitter', () => {
    it('should subscribe to event emitter', () => {
      render(<RunMode />)

      expect(mockEventEmitter.useSubscription).toHaveBeenCalled()
    })

    it('should call handleStopRun when EVENT_WORKFLOW_STOP event is emitted', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-456',
        result: { status: WorkflowRunningStatus.Running },
      }

      let subscriptionCallback: ((v: { type: string }) => void) | null = null
      mockEventEmitter.useSubscription.mockImplementation((callback: (v: { type: string }) => void) => {
        subscriptionCallback = callback
      })

      render(<RunMode />)

      expect(subscriptionCallback).not.toBeNull()
      subscriptionCallback!({ type: 'WORKFLOW_STOP' })

      expect(mockHandleStopRun).toHaveBeenCalledWith('task-456')
    })

    it('should not call handleStopRun for other event types', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-789',
        result: { status: WorkflowRunningStatus.Running },
      }

      let subscriptionCallback: ((v: { type: string }) => void) | null = null
      mockEventEmitter.useSubscription.mockImplementation((callback: (v: { type: string }) => void) => {
        subscriptionCallback = callback
      })

      render(<RunMode />)

      subscriptionCallback!({ type: 'some_other_event' })

      expect(mockHandleStopRun).not.toHaveBeenCalled()
    })

    it('should handle undefined eventEmitter gracefully', () => {
      mockEventEmitterEnabled = false

      expect(() => render(<RunMode />)).not.toThrow()
    })

    it('should not subscribe when eventEmitter is undefined', () => {
      mockEventEmitterEnabled = false
      vi.clearAllMocks()

      render(<RunMode />)

      expect(mockEventEmitter.useSubscription).not.toHaveBeenCalled()
    })
  })

  describe('Styles', () => {
    it('should have rounded-md class when not disabled', () => {
      render(<RunMode />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('rounded-md')
    })

    it('should have rounded-l-md class when disabled', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      expect(runButton).toHaveClass('rounded-l-md')
    })

    it('should have cursor-not-allowed when disabled', () => {
      mockStoreState.isPreparingDataSource = true

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      expect(runButton).toHaveClass('cursor-not-allowed')
    })

    it('should have bg-state-accent-hover when disabled', () => {
      mockStoreState.isPreparingDataSource = true

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      expect(runButton).toHaveClass('bg-state-accent-hover')
    })

    it('should have bg-state-accent-active on stop button', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const stopButton = screen.getAllByRole('button')[1]
      expect(stopButton).toHaveClass('bg-state-accent-active')
    })

    it('should have rounded-r-md on stop button', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const stopButton = screen.getAllByRole('button')[1]
      expect(stopButton).toHaveClass('rounded-r-md')
    })

    it('should have size-7 on stop button', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const stopButton = screen.getAllByRole('button')[1]
      expect(stopButton).toHaveClass('size-7')
    })

    it('should have correct base classes on run button', () => {
      render(<RunMode />)

      const runButton = screen.getByRole('button')
      expect(runButton).toHaveClass('system-xs-medium')
      expect(runButton).toHaveClass('h-7')
      expect(runButton).toHaveClass('px-1.5')
      expect(runButton).toHaveClass('text-text-accent')
    })

    it('should have gap-x-px on container', () => {
      const { container } = render(<RunMode />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('gap-x-px')
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
    })
  })

  describe('Memoization', () => {
    it('should be wrapped in React.memo', () => {
      expect((RunMode as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})

describe('Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalOpenState = false
    mockStoreState = {
      pipelineId: 'test-pipeline-id',
      showDebugAndPreviewPanel: false,
      publishedAt: 0,
      draftUpdatedAt: Date.now(),
      workflowRunningData: null,
      isPreparingDataSource: false,
      setShowInputFieldPanel: mockSetShowInputFieldPanel,
      setShowEnvPanel: mockSetShowEnvPanel,
    }
  })

  it('should render all child components in RagPipelineHeader', () => {
    render(<RagPipelineHeader />)

    expect(screen.getByText(/inputField/i)).toBeInTheDocument()

    expect(screen.getByTestId('header-middle')).toBeInTheDocument()
  })

  it('should pass correct history URL based on pipelineId', () => {
    mockStoreState.pipelineId = 'custom-pipeline-123'

    render(<RagPipelineHeader />)

    const viewHistoryContent = screen.getByTestId('header-view-history').textContent
    expect(viewHistoryContent).toContain('/rag/pipelines/custom-pipeline-123/workflow-runs')
  })
})

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Null/Undefined Values', () => {
    it('should handle null workflowRunningData', () => {
      mockStoreState.workflowRunningData = null

      render(<RunMode />)

      expect(screen.getByText(/pipeline.common.testRun/i)).toBeInTheDocument()
    })

    it('should handle empty pipelineId', () => {
      mockStoreState.pipelineId = ''

      render(<RagPipelineHeader />)

      const viewHistoryContent = screen.getByTestId('header-view-history').textContent
      expect(viewHistoryContent).toContain('/rag/pipelines//workflow-runs')
    })

    it('should throw when result is undefined in workflowRunningData', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: undefined as unknown as { status: WorkflowRunningStatus },
      }

      expect(() => render(<RunMode />)).toThrow()
    })
  })

  describe('RunMode Edge Cases', () => {
    beforeEach(() => {
      mockStoreState.workflowRunningData = null
      mockStoreState.isPreparingDataSource = false
    })

    it('should handle both isPreparingDataSource and isRunning being true', () => {
      mockStoreState.isPreparingDataSource = true
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      expect(runButton).toBeDisabled()
    })

    it('should show testRun text when workflowRunningData is null', () => {
      mockStoreState.workflowRunningData = null
      mockStoreState.isPreparingDataSource = false

      render(<RunMode />)

      const button = screen.getByRole('button')
      expect(button).not.toBeDisabled()
      expect(button.textContent).toContain('pipeline.common.testRun')
    })

    it('should use custom text when provided and workflowRunningData is null', () => {
      mockStoreState.workflowRunningData = null
      mockStoreState.isPreparingDataSource = false

      render(<RunMode text="Start Pipeline" />)

      expect(screen.getByText('Start Pipeline')).toBeInTheDocument()
    })

    it('should show reRun instead of custom text when workflowRunningData exists', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Succeeded },
      }
      mockStoreState.isPreparingDataSource = false

      render(<RunMode text="Start Pipeline" />)

      const button = screen.getByRole('button')
      expect(button.textContent).toContain('pipeline.common.reRun')
      expect(screen.queryByText('Start Pipeline')).not.toBeInTheDocument()
    })

    it('should show keyboard shortcuts with correct styling', () => {
      mockStoreState.workflowRunningData = null
      mockStoreState.isPreparingDataSource = false

      render(<RunMode />)

      expect(screen.getByText('alt')).toBeInTheDocument()
      expect(screen.getByText('R')).toBeInTheDocument()
    })

    it('should have correct structure with play icon when not disabled', () => {
      mockStoreState.workflowRunningData = null
      mockStoreState.isPreparingDataSource = false

      render(<RunMode />)

      const button = screen.getByRole('button')
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('should have correct structure with loader icon when running', () => {
      mockStoreState.workflowRunningData = {
        task_id: 'task-123',
        result: { status: WorkflowRunningStatus.Running },
      }

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      const spinningIcon = runButton.querySelector('.animate-spin')
      expect(spinningIcon).toBeInTheDocument()
    })

    it('should have correct structure with database icon when preparing data source', () => {
      mockStoreState.isPreparingDataSource = true

      render(<RunMode />)

      const runButton = screen.getAllByRole('button')[0]
      expect(runButton.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Boundary Conditions', () => {
    it('should handle zero draftUpdatedAt', () => {
      mockStoreState.publishedAt = 0
      mockStoreState.draftUpdatedAt = 0

      render(<Popup />)

      expect(screen.getByText(/workflow.common.autoSaved/i)).toBeInTheDocument()
    })

    it('should handle very old publishedAt timestamp', () => {
      mockStoreState.publishedAt = 1

      render(<Popup />)

      expect(screen.getByText(/workflow.common.latestPublished/i)).toBeInTheDocument()
    })
  })
})
