import type { ReactElement } from 'react'
import type { AppPublisherProps } from '@/app/components/app/app-publisher'
import type { App } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import FeaturesTrigger from './features-trigger'

const mockUseIsChatMode = vi.fn()
const mockUseTheme = vi.fn()
const mockUseNodesReadOnly = vi.fn()
const mockUseChecklist = vi.fn()
const mockUseChecklistBeforePublish = vi.fn()
const mockUseNodesSyncDraft = vi.fn()
const mockUseFeatures = vi.fn()
const mockUseProviderContext = vi.fn()
const mockUseNodes = vi.fn()
const mockUseEdges = vi.fn()

const mockNotify = vi.fn()
const mockHandleCheckBeforePublish = vi.fn()
const mockHandleSyncWorkflowDraft = vi.fn()
const mockPublishWorkflow = vi.fn()
const mockUpdatePublishedWorkflow = vi.fn()
const mockResetWorkflowVersionHistory = vi.fn()
const mockInvalidateAppTriggers = vi.fn()
const mockFetchAppDetail = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetLastPublishedHasUserInput = vi.fn()

const mockWorkflowStoreSetState = vi.fn()
const mockWorkflowStoreSetShowFeaturesPanel = vi.fn()

let workflowStoreState = {
  showFeaturesPanel: false,
  isRestoring: false,
  setShowFeaturesPanel: mockWorkflowStoreSetShowFeaturesPanel,
  setPublishedAt: mockSetPublishedAt,
  setLastPublishedHasUserInput: mockSetLastPublishedHasUserInput,
}

const mockWorkflowStore = {
  getState: () => workflowStoreState,
  setState: mockWorkflowStoreSetState,
}

vi.mock('@/app/components/workflow/hooks', () => ({
  useChecklist: (...args: unknown[]) => mockUseChecklist(...args),
  useChecklistBeforePublish: () => mockUseChecklistBeforePublish(),
  useNodesReadOnly: () => mockUseNodesReadOnly(),
  useNodesSyncDraft: () => mockUseNodesSyncDraft(),
  useIsChatMode: () => mockUseIsChatMode(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      publishedAt: null,
      draftUpdatedAt: null,
      toolPublished: false,
      lastPublishedHasUserInput: false,
    }
    return selector(state)
  },
  useWorkflowStore: () => mockWorkflowStore,
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: Record<string, unknown>) => unknown) => mockUseFeatures(selector),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  default: () => mockUseNodes(),
}))

vi.mock('reactflow', () => ({
  useEdges: () => mockUseEdges(),
}))

vi.mock('@/app/components/app/app-publisher', () => ({
  default: (props: AppPublisherProps) => {
    const inputs = props.inputs ?? []
    return (
      <div
        data-testid="app-publisher"
        data-disabled={String(Boolean(props.disabled))}
        data-publish-disabled={String(Boolean(props.publishDisabled))}
        data-start-node-limit-exceeded={String(Boolean(props.startNodeLimitExceeded))}
        data-has-trigger-node={String(Boolean(props.hasTriggerNode))}
        data-inputs={JSON.stringify(inputs)}
      >
        <button type="button" onClick={() => { props.onRefreshData?.() }}>
          publisher-refresh
        </button>
        <button type="button" onClick={() => { props.onToggle?.(true) }}>
          publisher-toggle-on
        </button>
        <button type="button" onClick={() => { props.onToggle?.(false) }}>
          publisher-toggle-off
        </button>
        <button type="button" onClick={() => { Promise.resolve(props.onPublish?.()).catch(() => undefined) }}>
          publisher-publish
        </button>
        <button type="button" onClick={() => { Promise.resolve(props.onPublish?.({ title: 'Test title', releaseNotes: 'Test notes' })).catch(() => undefined) }}>
          publisher-publish-with-params
        </button>
      </div>
    )
  },
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateAppWorkflow: () => mockUpdatePublishedWorkflow,
  usePublishWorkflow: () => ({ mutateAsync: mockPublishWorkflow }),
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateAppTriggers: () => mockInvalidateAppTriggers,
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetail: (...args: unknown[]) => mockFetchAppDetail(...args),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => mockUseTheme(),
}))

// Use real app store - global zustand mock will auto-reset between tests

const createProviderContext = ({
  type = Plan.sandbox,
  isFetchedPlan = true,
}: {
  type?: Plan
  isFetchedPlan?: boolean
}) => ({
  plan: { type },
  isFetchedPlan,
})

const renderWithToast = (ui: ReactElement) => {
  return render(
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      {ui}
    </ToastContext.Provider>,
  )
}

describe('FeaturesTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = {
      showFeaturesPanel: false,
      isRestoring: false,
      setShowFeaturesPanel: mockWorkflowStoreSetShowFeaturesPanel,
      setPublishedAt: mockSetPublishedAt,
      setLastPublishedHasUserInput: mockSetLastPublishedHasUserInput,
    }

    mockUseTheme.mockReturnValue({ theme: 'light' })
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseChecklist.mockReturnValue([])
    mockUseChecklistBeforePublish.mockReturnValue({ handleCheckBeforePublish: mockHandleCheckBeforePublish })
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    mockUseNodesSyncDraft.mockReturnValue({ handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft })
    mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => selector({ features: { file: {} } }))
    mockUseProviderContext.mockReturnValue(createProviderContext({}))
    mockUseNodes.mockReturnValue([])
    mockUseEdges.mockReturnValue([])
    // Set up app store state
    useAppStore.setState({ appDetail: { id: 'app-id' } as unknown as App })
    mockFetchAppDetail.mockResolvedValue({ id: 'app-id' })
    mockPublishWorkflow.mockResolvedValue({ created_at: '2024-01-01T00:00:00Z' })
  })

  // Verifies the feature toggle button only appears in chatflow mode.
  describe('Rendering', () => {
    it('should not render the features button when not in chat mode', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(false)

      // Act
      renderWithToast(<FeaturesTrigger />)

      // Assert
      expect(screen.queryByRole('button', { name: /workflow\.common\.features/i })).not.toBeInTheDocument()
    })

    it('should render the features button when in chat mode', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(true)

      // Act
      renderWithToast(<FeaturesTrigger />)

      // Assert
      expect(screen.getByRole('button', { name: /workflow\.common\.features/i })).toBeInTheDocument()
    })

    it('should apply dark theme styling when theme is dark', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(true)
      mockUseTheme.mockReturnValue({ theme: 'dark' })

      // Act
      renderWithToast(<FeaturesTrigger />)

      // Assert
      expect(screen.getByRole('button', { name: /workflow\.common\.features/i })).toHaveClass('rounded-lg')
    })
  })

  // Verifies user clicks toggle the features panel visibility.
  describe('User Interactions', () => {
    it('should toggle features panel when clicked and nodes are editable', async () => {
      // Arrange
      const user = userEvent.setup()
      mockUseIsChatMode.mockReturnValue(true)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })

      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: /workflow\.common\.features/i }))

      // Assert
      expect(mockWorkflowStoreSetShowFeaturesPanel).toHaveBeenCalledWith(true)
    })
  })

  // Covers read-only gating that prevents toggling unless restoring.
  describe('Edge Cases', () => {
    it('should not toggle features panel when nodes are read-only and not restoring', async () => {
      // Arrange
      const user = userEvent.setup()
      mockUseIsChatMode.mockReturnValue(true)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true, getNodesReadOnly: () => true })
      workflowStoreState = {
        ...workflowStoreState,
        isRestoring: false,
      }

      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: /workflow\.common\.features/i }))

      // Assert
      expect(mockWorkflowStoreSetShowFeaturesPanel).not.toHaveBeenCalled()
    })
  })

  // Verifies the publisher reflects the presence of workflow nodes.
  describe('Props', () => {
    it('should disable AppPublisher when there are no workflow nodes', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(false)
      mockUseNodes.mockReturnValue([])

      // Act
      renderWithToast(<FeaturesTrigger />)

      // Assert
      expect(screen.getByTestId('app-publisher')).toHaveAttribute('data-disabled', 'true')
    })
  })

  // Verifies derived props passed into AppPublisher (variables, limits, and triggers).
  describe('Computed Props', () => {
    it('should append image input when file image upload is enabled', () => {
      // Arrange
      mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => selector({
        features: { file: { image: { enabled: true } } },
      }))
      mockUseNodes.mockReturnValue([
        { id: 'start', data: { type: BlockEnum.Start } },
      ])

      // Act
      renderWithToast(<FeaturesTrigger />)

      // Assert
      const inputs = JSON.parse(screen.getByTestId('app-publisher').getAttribute('data-inputs') ?? '[]') as Array<{
        type?: string
        variable?: string
        required?: boolean
        label?: string
      }>
      expect(inputs).toContainEqual({
        type: InputVarType.files,
        variable: '__image',
        required: false,
        label: 'files',
      })
    })

    it('should set startNodeLimitExceeded when sandbox entry limit is exceeded', () => {
      // Arrange
      mockUseNodes.mockReturnValue([
        { id: 'start', data: { type: BlockEnum.Start } },
        { id: 'trigger-1', data: { type: BlockEnum.TriggerWebhook } },
        { id: 'trigger-2', data: { type: BlockEnum.TriggerSchedule } },
        { id: 'end', data: { type: BlockEnum.End } },
      ])

      // Act
      renderWithToast(<FeaturesTrigger />)

      // Assert
      const publisher = screen.getByTestId('app-publisher')
      expect(publisher).toHaveAttribute('data-start-node-limit-exceeded', 'true')
      expect(publisher).toHaveAttribute('data-publish-disabled', 'true')
      expect(publisher).toHaveAttribute('data-has-trigger-node', 'true')
    })
  })

  // Verifies callbacks wired from AppPublisher to stores and draft syncing.
  describe('Callbacks', () => {
    it('should set toolPublished when AppPublisher refreshes data', async () => {
      // Arrange
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: 'publisher-refresh' }))

      // Assert
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ toolPublished: true })
    })

    it('should sync workflow draft when AppPublisher toggles on', async () => {
      // Arrange
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: 'publisher-toggle-on' }))

      // Assert
      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    })

    it('should not sync workflow draft when AppPublisher toggles off', async () => {
      // Arrange
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: 'publisher-toggle-off' }))

      // Assert
      expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  // Verifies publishing behavior across warnings, validation, and success.
  describe('Publishing', () => {
    it('should notify error and reject publish when checklist has warning nodes', async () => {
      // Arrange
      const user = userEvent.setup()
      mockUseChecklist.mockReturnValue([{ id: 'warning' }])
      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'workflow.panel.checklistTip' })
      })
      expect(mockPublishWorkflow).not.toHaveBeenCalled()
    })

    it('should reject publish when checklist before publish fails', async () => {
      // Arrange
      const user = userEvent.setup()
      mockHandleCheckBeforePublish.mockResolvedValue(false)
      renderWithToast(<FeaturesTrigger />)

      // Act & Assert
      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      await waitFor(() => {
        expect(mockHandleCheckBeforePublish).toHaveBeenCalled()
      })
      expect(mockPublishWorkflow).not.toHaveBeenCalled()
    })

    it('should publish workflow and update related stores when validation passes', async () => {
      // Arrange
      const user = userEvent.setup()
      mockUseNodes.mockReturnValue([
        { id: 'start', data: { type: BlockEnum.Start } },
      ])
      mockUseEdges.mockReturnValue([
        { source: 'start' },
      ])
      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      // Assert
      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalledWith({
          url: '/apps/app-id/workflows/publish',
          title: '',
          releaseNotes: '',
        })
        expect(mockUpdatePublishedWorkflow).toHaveBeenCalledWith('app-id')
        expect(mockInvalidateAppTriggers).toHaveBeenCalledWith('app-id')
        expect(mockSetPublishedAt).toHaveBeenCalledWith('2024-01-01T00:00:00Z')
        expect(mockSetLastPublishedHasUserInput).toHaveBeenCalledWith(true)
        expect(mockResetWorkflowVersionHistory).toHaveBeenCalled()
        expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'common.api.actionSuccess' })
        expect(mockFetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-id' })
        expect(useAppStore.getState().appDetail).toBeDefined()
      })
    })

    it('should pass publish params to workflow publish mutation', async () => {
      // Arrange
      const user = userEvent.setup()
      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: 'publisher-publish-with-params' }))

      // Assert
      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalledWith({
          url: '/apps/app-id/workflows/publish',
          title: 'Test title',
          releaseNotes: 'Test notes',
        })
      })
    })

    it('should log error when app detail refresh fails after publish', async () => {
      // Arrange
      const user = userEvent.setup()
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mockFetchAppDetail.mockRejectedValue(new Error('fetch failed'))

      renderWithToast(<FeaturesTrigger />)

      // Act
      await user.click(screen.getByRole('button', { name: 'publisher-publish' }))

      // Assert
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled()
      })
      consoleErrorSpy.mockRestore()
    })
  })
})
