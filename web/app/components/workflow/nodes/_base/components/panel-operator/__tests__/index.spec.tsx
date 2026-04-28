import type { UseQueryResult } from '@tanstack/react-query'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  useNodeDataUpdate,
  useNodeMetaData,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAllWorkflowTools } from '@/service/use-tools'
import PanelOperator from '../index'

vi.mock('@/app/components/workflow/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/hooks')>()
  return {
    ...actual,
    useNodeDataUpdate: vi.fn(),
    useNodeMetaData: vi.fn(),
    useNodesInteractions: vi.fn(),
    useNodesReadOnly: vi.fn(),
    useNodesSyncDraft: vi.fn(),
  }
})

vi.mock('@/service/use-tools', () => ({
  useAllWorkflowTools: vi.fn(),
}))

vi.mock('../change-block', () => ({
  default: () => <div data-testid="panel-operator-change-block" />,
}))

const mockUseNodeDataUpdate = vi.mocked(useNodeDataUpdate)
const mockUseNodeMetaData = vi.mocked(useNodeMetaData)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseNodesSyncDraft = vi.mocked(useNodesSyncDraft)
const mockUseAllWorkflowTools = vi.mocked(useAllWorkflowTools)

const createQueryResult = <T,>(data: T): UseQueryResult<T, Error> => ({
  data,
  error: null,
  refetch: vi.fn(),
  isError: false,
  isPending: false,
  isLoading: false,
  isSuccess: true,
  isFetching: false,
  isRefetching: false,
  isLoadingError: false,
  isRefetchError: false,
  isInitialLoading: false,
  isPaused: false,
  isEnabled: true,
  status: 'success',
  fetchStatus: 'idle',
  dataUpdatedAt: Date.now(),
  errorUpdatedAt: 0,
  failureCount: 0,
  failureReason: null,
  errorUpdateCount: 0,
  isFetched: true,
  isFetchedAfterMount: true,
  isPlaceholderData: false,
  isStale: false,
  promise: Promise.resolve(data),
} as UseQueryResult<T, Error>)

const renderComponent = (
  showHelpLink: boolean = true,
  onOpenChange?: (open: boolean) => void,
  offset?: { mainAxis: number, crossAxis: number } | number,
) =>
  renderWorkflowFlowComponent(
    <PanelOperator
      id="node-1"
      data={{
        title: 'Code Node',
        desc: '',
        type: BlockEnum.Code,
      }}
      triggerClassName="panel-operator-trigger"
      offset={offset}
      onOpenChange={onOpenChange}
      showHelpLink={showHelpLink}
    />,
    {
      nodes: [],
      edges: [],
    },
  )

describe('PanelOperator', () => {
  const handleNodeSelect = vi.fn()
  const handleNodeDataUpdate = vi.fn()
  const handleSyncWorkflowDraft = vi.fn()
  const handleNodeDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeDataUpdate.mockReturnValue({
      handleNodeDataUpdate,
      handleNodeDataUpdateWithSyncDraft: vi.fn(),
    })
    mockUseNodeMetaData.mockReturnValue({
      isTypeFixed: false,
      isSingleton: false,
      isUndeletable: false,
      description: 'Node description',
      author: 'Dify',
      helpLinkUri: 'https://docs.example.com/node',
    } as ReturnType<typeof useNodeMetaData>)
    mockUseNodesInteractions.mockReturnValue({
      handleNodeDelete,
      handleNodesDuplicate: vi.fn(),
      handleNodeSelect,
      handleNodesCopy: vi.fn(),
    } as unknown as ReturnType<typeof useNodesInteractions>)
    mockUseNodesReadOnly.mockReturnValue({
      nodesReadOnly: false,
    } as ReturnType<typeof useNodesReadOnly>)
    mockUseNodesSyncDraft.mockReturnValue({
      doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
      handleSyncWorkflowDraft,
      syncWorkflowDraftWhenPageClose: vi.fn(),
    })
    mockUseAllWorkflowTools.mockReturnValue(createQueryResult<ToolWithProvider[]>([]))
  })

  // The operator should open the real popup, expose actionable items, and respect help-link visibility.
  describe('Popup Interaction', () => {
    it('should open the popup and trigger single-run actions', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      const { container } = renderComponent(true, onOpenChange)

      await user.click(container.querySelector('.panel-operator-trigger') as HTMLElement)

      expect(onOpenChange).toHaveBeenCalledWith(true)
      expect(screen.getByText('workflow.panel.runThisStep')).toBeInTheDocument()
      expect(screen.getByText('Node description')).toBeInTheDocument()

      await user.click(screen.getByText('workflow.panel.runThisStep'))

      expect(handleNodeSelect).toHaveBeenCalledWith('node-1')
      expect(handleNodeDataUpdate).toHaveBeenCalledWith({
        id: 'node-1',
        data: { _isSingleRun: true },
      })
      expect(handleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    })

    it('should hide the help link when showHelpLink is false', async () => {
      const user = userEvent.setup()
      const { container } = renderComponent(false)

      await user.click(container.querySelector('.panel-operator-trigger') as HTMLElement)

      expect(screen.queryByText('workflow.panel.helpLink')).not.toBeInTheDocument()
      expect(screen.getByText('Node description')).toBeInTheDocument()
    })

    it('should still open the popup when using a numeric offset and no open-change callback', async () => {
      const user = userEvent.setup()
      const { container } = renderComponent(true, undefined, 0)

      await user.click(container.querySelector('.panel-operator-trigger') as HTMLElement)

      expect(screen.getByText('workflow.panel.runThisStep')).toBeInTheDocument()
      expect(screen.getByText('Node description')).toBeInTheDocument()
    })
  })
})
