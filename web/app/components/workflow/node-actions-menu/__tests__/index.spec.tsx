import type { UseQueryResult } from '@tanstack/react-query'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Node, ToolWithProvider } from '@/app/components/workflow/types'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { useAllBuiltInTools, useAllWorkflowTools } from '@/service/use-tools'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useNodeMetaData } from '../../hooks/use-nodes-meta-data'
import { useNodesReadOnly } from '../../hooks/use-workflow'
import { NodeActionsDropdown } from '../index'

vi.mock('../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: vi.fn(),
  }
})

vi.mock('../../hooks/use-nodes-meta-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-meta-data')>()

  return {
    ...actual,
    useNodeMetaData: vi.fn(),
  }
})

vi.mock('../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-workflow')>()

  return {
    ...actual,
    useNodesReadOnly: vi.fn(),
  }
})

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: vi.fn(),
  useAllWorkflowTools: vi.fn(),
}))

vi.mock('../change-block-popup', () => ({
  ChangeBlockPopup: () => <div data-testid="node-actions-change-block" />,
}))

const mockUseNodeMetaData = vi.mocked(useNodeMetaData)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseAllWorkflowTools = vi.mocked(useAllWorkflowTools)
const mockUseAllBuiltInTools = vi.mocked(useAllBuiltInTools)

const createQueryResult = <T,>(data: T): UseQueryResult<T, Error> =>
  ({
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
  }) as UseQueryResult<T, Error>

const toolProvider: ToolWithProvider = {
  id: 'provider-id',
  name: 'test-provider',
  author: 'Dify',
  description: { en_US: 'Test provider', zh_Hans: '测试提供商' },
  label: { en_US: 'Test provider', zh_Hans: '测试提供商' },
  icon: '',
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: true,
  labels: [],
  tools: [],
}

const makeToolData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Tool node',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: toolProvider.id,
  provider_name: toolProvider.name,
  provider_type: CollectionType.builtIn,
  tool_name: 'test-tool',
  tool_label: 'Test tool',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

const renderComponent = (
  showHelpLink: boolean = true,
  onOpenChange?: (open: boolean) => void,
  data?: Node['data'],
) =>
  renderWorkflowFlowComponent(
    <NodeActionsDropdown
      id="node-1"
      data={
        data ?? {
          title: 'Code Node',
          desc: '',
          type: BlockEnum.Code,
        }
      }
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
  const handleNodesCopy = vi.fn()
  const handleNodesDuplicate = vi.fn()

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
      handleNodesDuplicate,
      handleNodeSelect,
      handleNodesCopy,
    } as unknown as ReturnType<typeof useNodesInteractions>)
    mockUseNodesReadOnly.mockReturnValue({
      nodesReadOnly: false,
    } as ReturnType<typeof useNodesReadOnly>)
    mockUseAllWorkflowTools.mockReturnValue(createQueryResult<ToolWithProvider[]>([]))
    mockUseAllBuiltInTools.mockReturnValue(createQueryResult<ToolWithProvider[]>([]))
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

  it('blocks a tool run in the menu when Workspace authorization is missing', async () => {
    const user = userEvent.setup()
    mockUseAllBuiltInTools.mockReturnValue(createQueryResult([toolProvider]))
    const { store } = renderComponent(true, undefined, makeToolData())
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    const run = screen.getByRole('menuitem', { name: 'workflow.panel.runThisStep' })

    expect(run).toHaveAttribute('aria-disabled', 'true')
    expect(run).toHaveAttribute(
      'aria-description',
      'workflow.panel.configureWorkspaceAuthorization',
    )
    await user.click(run)

    expect(store.getState().pendingSingleRun).toBeUndefined()
    expect(store.getState().initShowLastRunTab).toBe(false)
    expect(handleNodeSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('updates the open menu when the App user test connection is removed', async () => {
    const user = userEvent.setup()
    mockUseAllBuiltInTools.mockReturnValue(createQueryResult([toolProvider]))
    const { store } = renderComponent(true, undefined, makeToolData())
    act(() => {
      store.getState().setNodeAppUserAuthDraft('node-1', toolProvider.name, toolProvider.id, {
        oauthEnabled: false,
        apiKeyEnabled: true,
        description: 'Connect app users',
      })
      store
        .getState()
        .setNodeAuthorizationTab('node-1', toolProvider.name, toolProvider.id, 'app-user-auth')
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(
      screen.getByRole('menuitem', { name: 'workflow.panel.runThisStep' }),
    ).not.toHaveAttribute('aria-disabled', 'true')

    act(() =>
      store.getState().setNodeAppUserAuthDraft('node-1', toolProvider.name, toolProvider.id, {
        oauthEnabled: false,
        apiKeyEnabled: true,
        description: 'Connect app users',
        testConnection: { connections: [] },
      }),
    )
    const run = screen.getByRole('menuitem', { name: 'workflow.panel.runThisStep' })
    expect(run).toHaveAttribute('aria-disabled', 'true')
    expect(run).toHaveAttribute('aria-description', 'workflow.panel.configureTestRunConnection')
    await user.click(run)

    expect(store.getState().pendingSingleRun).toBeUndefined()
    expect(handleNodeSelect).not.toHaveBeenCalled()
  })

  it('keeps the menu stop action available when Workspace authorization is missing', async () => {
    const user = userEvent.setup()
    mockUseAllBuiltInTools.mockReturnValue(createQueryResult([toolProvider]))
    const { store } = renderComponent(
      true,
      undefined,
      makeToolData({ _singleRunningStatus: NodeRunningStatus.Running }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    const stop = screen.getByRole('menuitem', {
      name: 'workflowDebug.debug.variableInspect.trigger.stop',
    })

    expect(stop).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(stop)

    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'stop' })
    expect(handleNodeSelect).toHaveBeenCalledExactlyOnceWith('node-1')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each([
    { key: 'c', action: handleNodesCopy },
    { key: 'd', action: handleNodesDuplicate },
    { key: 'Delete', action: handleNodeDelete },
    { key: 'Backspace', action: handleNodeDelete },
  ])('runs $key from the focused portalled node menu', async ({ key, action }) => {
    const user = userEvent.setup()
    const { container } = renderComponent()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const focusedItem = document.activeElement
    expect(focusedItem).toHaveAttribute('role', 'menuitem')
    expect(container.contains(focusedItem)).toBe(false)

    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)

    expect(action).toHaveBeenCalledExactlyOnceWith('node-1')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('leaves composition alone and consumes held shortcuts without repeating the action', async () => {
    const user = userEvent.setup()
    renderComponent()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const item = document.activeElement!
    const modifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
    const composing = new KeyboardEvent('keydown', {
      key: 'd',
      ...modifier,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(item, composing)
    expect(composing.defaultPrevented).toBe(false)
    const repeat = new KeyboardEvent('keydown', {
      key: 'd',
      ...modifier,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(item, repeat)
    expect(repeat.defaultPrevented).toBe(true)
    expect(handleNodesDuplicate).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('does not run unavailable editing shortcuts from a readonly node menu', async () => {
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true } as ReturnType<
      typeof useNodesReadOnly
    >)
    const user = userEvent.setup()
    renderComponent()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(`{${mod}>}cd{/${mod}}{Delete}`)
    expect(handleNodesCopy).not.toHaveBeenCalled()
    expect(handleNodesDuplicate).not.toHaveBeenCalled()
    expect(handleNodeDelete).not.toHaveBeenCalled()
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
