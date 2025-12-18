import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Plan } from '@/app/components/billing/type'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import FeaturesTrigger from './features-trigger'

const mockUseIsChatMode = jest.fn()
const mockUseTheme = jest.fn()
const mockUseNodesReadOnly = jest.fn()
const mockUseChecklist = jest.fn()
const mockUseChecklistBeforePublish = jest.fn()
const mockUseNodesSyncDraft = jest.fn()
const mockUseToastContext = jest.fn()
const mockUseFeatures = jest.fn()
const mockUseProviderContext = jest.fn()
const mockUseNodes = jest.fn()
const mockUseEdges = jest.fn()
const mockUseAppStoreSelector = jest.fn()

const mockNotify = jest.fn()
const mockHandleCheckBeforePublish = jest.fn()
const mockHandleSyncWorkflowDraft = jest.fn()
const mockPublishWorkflow = jest.fn()
const mockUpdatePublishedWorkflow = jest.fn()
const mockResetWorkflowVersionHistory = jest.fn()
const mockInvalidateAppTriggers = jest.fn()
const mockFetchAppDetail = jest.fn()
const mockSetAppDetail = jest.fn()
const mockSetPublishedAt = jest.fn()
const mockSetLastPublishedHasUserInput = jest.fn()

const mockWorkflowStoreSetState = jest.fn()
const mockWorkflowStoreSetShowFeaturesPanel = jest.fn()

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

let capturedAppPublisherProps: Record<string, unknown> | null = null

jest.mock('@/app/components/workflow/hooks', () => ({
  __esModule: true,
  useChecklist: (...args: unknown[]) => mockUseChecklist(...args),
  useChecklistBeforePublish: () => mockUseChecklistBeforePublish(),
  useNodesReadOnly: () => mockUseNodesReadOnly(),
  useNodesSyncDraft: () => mockUseNodesSyncDraft(),
  useIsChatMode: () => mockUseIsChatMode(),
}))

jest.mock('@/app/components/workflow/store', () => ({
  __esModule: true,
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

jest.mock('@/app/components/base/features/hooks', () => ({
  __esModule: true,
  useFeatures: (selector: (state: Record<string, unknown>) => unknown) => mockUseFeatures(selector),
}))

jest.mock('@/app/components/base/toast', () => ({
  __esModule: true,
  useToastContext: () => mockUseToastContext(),
}))

jest.mock('@/context/provider-context', () => ({
  __esModule: true,
  useProviderContext: () => mockUseProviderContext(),
}))

jest.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseNodes(),
}))

jest.mock('reactflow', () => ({
  __esModule: true,
  useEdges: () => mockUseEdges(),
}))

jest.mock('@/app/components/app/app-publisher', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    capturedAppPublisherProps = props
    return (
      <div
        data-testid='app-publisher'
        data-disabled={String(Boolean(props.disabled))}
        data-publish-disabled={String(Boolean(props.publishDisabled))}
      />
    )
  },
}))

jest.mock('@/service/use-workflow', () => ({
  __esModule: true,
  useInvalidateAppWorkflow: () => mockUpdatePublishedWorkflow,
  usePublishWorkflow: () => ({ mutateAsync: mockPublishWorkflow }),
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

jest.mock('@/service/use-tools', () => ({
  __esModule: true,
  useInvalidateAppTriggers: () => mockInvalidateAppTriggers,
}))

jest.mock('@/service/apps', () => ({
  __esModule: true,
  fetchAppDetail: (...args: unknown[]) => mockFetchAppDetail(...args),
}))

jest.mock('@/hooks/use-theme', () => ({
  __esModule: true,
  default: () => mockUseTheme(),
}))

jest.mock('@/app/components/app/store', () => ({
  __esModule: true,
  useStore: (selector: (state: { appDetail?: { id: string }; setAppDetail: typeof mockSetAppDetail }) => unknown) => mockUseAppStoreSelector(selector),
}))

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

describe('FeaturesTrigger', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedAppPublisherProps = null
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
    mockUseToastContext.mockReturnValue({ notify: mockNotify })
    mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => selector({ features: { file: {} } }))
    mockUseProviderContext.mockReturnValue(createProviderContext({}))
    mockUseNodes.mockReturnValue([])
    mockUseEdges.mockReturnValue([])
    mockUseAppStoreSelector.mockImplementation(selector => selector({ appDetail: { id: 'app-id' }, setAppDetail: mockSetAppDetail }))
    mockFetchAppDetail.mockResolvedValue({ id: 'app-id' })
    mockPublishWorkflow.mockResolvedValue({ created_at: '2024-01-01T00:00:00Z' })
  })

  // Verifies the feature toggle button only appears in chatflow mode.
  describe('Rendering', () => {
    it('should not render the features button when not in chat mode', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(false)

      // Act
      render(<FeaturesTrigger />)

      // Assert
      expect(screen.queryByRole('button', { name: /workflow\.common\.features/i })).not.toBeInTheDocument()
    })

    it('should render the features button when in chat mode', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(true)

      // Act
      render(<FeaturesTrigger />)

      // Assert
      expect(screen.getByRole('button', { name: /workflow\.common\.features/i })).toBeInTheDocument()
    })

    it('should apply dark theme styling when theme is dark', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(true)
      mockUseTheme.mockReturnValue({ theme: 'dark' })

      // Act
      render(<FeaturesTrigger />)

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

      render(<FeaturesTrigger />)

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

      render(<FeaturesTrigger />)

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
      render(<FeaturesTrigger />)

      // Assert
      expect(capturedAppPublisherProps?.disabled).toBe(true)
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
      render(<FeaturesTrigger />)

      // Assert
      const inputs = (capturedAppPublisherProps?.inputs as unknown as Array<{ type?: string; variable?: string }>) || []
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
      render(<FeaturesTrigger />)

      // Assert
      expect(capturedAppPublisherProps?.startNodeLimitExceeded).toBe(true)
      expect(capturedAppPublisherProps?.publishDisabled).toBe(true)
      expect(capturedAppPublisherProps?.hasTriggerNode).toBe(true)
    })
  })

  // Verifies callbacks wired from AppPublisher to stores and draft syncing.
  describe('Callbacks', () => {
    it('should set toolPublished when AppPublisher refreshes data', () => {
      // Arrange
      render(<FeaturesTrigger />)
      const refresh = capturedAppPublisherProps?.onRefreshData as unknown as (() => void) | undefined
      expect(refresh).toBeDefined()

      // Act
      refresh?.()

      // Assert
      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ toolPublished: true })
    })

    it('should sync workflow draft when AppPublisher toggles on', () => {
      // Arrange
      render(<FeaturesTrigger />)
      const onToggle = capturedAppPublisherProps?.onToggle as unknown as ((state: boolean) => void) | undefined
      expect(onToggle).toBeDefined()

      // Act
      onToggle?.(true)

      // Assert
      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    })

    it('should not sync workflow draft when AppPublisher toggles off', () => {
      // Arrange
      render(<FeaturesTrigger />)
      const onToggle = capturedAppPublisherProps?.onToggle as unknown as ((state: boolean) => void) | undefined
      expect(onToggle).toBeDefined()

      // Act
      onToggle?.(false)

      // Assert
      expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  // Verifies publishing behavior across warnings, validation, and success.
  describe('Publishing', () => {
    it('should notify error and reject publish when checklist has warning nodes', async () => {
      // Arrange
      mockUseChecklist.mockReturnValue([{ id: 'warning' }])
      render(<FeaturesTrigger />)

      const onPublish = capturedAppPublisherProps?.onPublish as unknown as (() => Promise<void>) | undefined
      expect(onPublish).toBeDefined()

      // Act
      await expect(onPublish?.()).rejects.toThrow('Checklist has unresolved items')

      // Assert
      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'workflow.panel.checklistTip' })
    })

    it('should reject publish when checklist before publish fails', async () => {
      // Arrange
      mockHandleCheckBeforePublish.mockResolvedValue(false)
      render(<FeaturesTrigger />)

      const onPublish = capturedAppPublisherProps?.onPublish as unknown as (() => Promise<void>) | undefined
      expect(onPublish).toBeDefined()

      // Act & Assert
      await expect(onPublish?.()).rejects.toThrow('Checklist failed')
    })

    it('should publish workflow and update related stores when validation passes', async () => {
      // Arrange
      mockUseNodes.mockReturnValue([
        { id: 'start', data: { type: BlockEnum.Start } },
      ])
      mockUseEdges.mockReturnValue([
        { source: 'start' },
      ])
      render(<FeaturesTrigger />)

      const onPublish = capturedAppPublisherProps?.onPublish as unknown as (() => Promise<void>) | undefined
      expect(onPublish).toBeDefined()

      // Act
      await onPublish?.()

      // Assert
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

      await waitFor(() => {
        expect(mockFetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-id' })
        expect(mockSetAppDetail).toHaveBeenCalled()
      })
    })

    it('should pass publish params to workflow publish mutation', async () => {
      // Arrange
      render(<FeaturesTrigger />)

      const onPublish = capturedAppPublisherProps?.onPublish as unknown as ((params: { title: string; releaseNotes: string }) => Promise<void>) | undefined
      expect(onPublish).toBeDefined()

      // Act
      await onPublish?.({ title: 'Test title', releaseNotes: 'Test notes' })

      // Assert
      expect(mockPublishWorkflow).toHaveBeenCalledWith({
        url: '/apps/app-id/workflows/publish',
        title: 'Test title',
        releaseNotes: 'Test notes',
      })
    })

    it('should log error when app detail refresh fails after publish', async () => {
      // Arrange
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      mockFetchAppDetail.mockRejectedValue(new Error('fetch failed'))

      render(<FeaturesTrigger />)

      const onPublish = capturedAppPublisherProps?.onPublish as unknown as (() => Promise<void>) | undefined
      expect(onPublish).toBeDefined()

      // Act
      await onPublish?.()

      // Assert
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled()
      })
      consoleErrorSpy.mockRestore()
    })
  })
})
