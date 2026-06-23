import type { UseQueryResult } from '@tanstack/react-query'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  useNodeMetaData,
  useNodesInteractions,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAllWorkflowTools } from '@/service/use-tools'
import { NodeActionsDropdown } from '../index'

vi.mock('@/app/components/workflow/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/hooks')>()
  return {
    ...actual,
    useNodeMetaData: vi.fn(),
    useNodesInteractions: vi.fn(),
    useNodesReadOnly: vi.fn(),
  }
})

vi.mock('@/service/use-tools', () => ({
  useAllWorkflowTools: vi.fn(),
}))

vi.mock('../change-block-menu-trigger', () => ({
  ChangeBlockMenuTrigger: () => <div data-testid="node-actions-change-block" />,
}))

const mockUseNodeMetaData = vi.mocked(useNodeMetaData)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
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
) =>
  renderWorkflowFlowComponent(
    <NodeActionsDropdown
      id="node-1"
      data={{
        title: 'Code Node',
        desc: '',
        type: BlockEnum.Code,
      }}
      triggerClassName="node-actions-trigger"
      onOpenChange={onOpenChange}
      showHelpLink={showHelpLink}
    />,
    {
      nodes: [],
      edges: [],
    },
  )

describe('NodeActionsDropdown', () => {
  const handleNodeSelect = vi.fn()
  const handleNodeDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
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
    mockUseAllWorkflowTools.mockReturnValue(createQueryResult<ToolWithProvider[]>([]))
  })

  it('should open the dropdown and trigger single-run actions', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { store } = renderComponent(true, onOpenChange)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.getByText('workflow.panel.runThisStep')).toBeInTheDocument()
    expect(screen.getByText('Node description')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.panel.runThisStep'))

    expect(handleNodeSelect).toHaveBeenCalledWith('node-1')
    expect(store.getState().initShowLastRunTab).toBe(true)
    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'run' })
  })

  it('should hide single-run actions when nodes are readonly', async () => {
    const user = userEvent.setup()
    mockUseNodesReadOnly.mockReturnValueOnce({
      nodesReadOnly: true,
    } as ReturnType<typeof useNodesReadOnly>)

    renderComponent()

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(screen.queryByText('workflow.panel.runThisStep')).not.toBeInTheDocument()
  })

  it('should hide the help link when showHelpLink is false', async () => {
    const user = userEvent.setup()
    renderComponent(false)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(screen.queryByText('workflow.panel.helpLink')).not.toBeInTheDocument()
    expect(screen.getByText('Node description')).toBeInTheDocument()
  })
})
