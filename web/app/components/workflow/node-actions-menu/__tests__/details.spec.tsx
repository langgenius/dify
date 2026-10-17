import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { BlockClassification } from '../../block-selector/types'
import { useAvailableBlocks } from '../../hooks/use-available-blocks'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useNodeMetaData } from '../../hooks/use-nodes-meta-data'
import { NodeActionsDropdown } from '../index'

vi.mock('../../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: vi.fn(),
  }
})

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

const { mockUseAllWorkflowTools } = vi.hoisted(() => ({ mockUseAllWorkflowTools: vi.fn() }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.tools.workflow.get': () => mockUseAllWorkflowTools(),
    'workspaces.current.tools.builtin.get': () => ({ data: [] }),
    'workspaces.current.tools.api.get': () => ({ data: [] }),
    'workspaces.current.tools.mcp.get': () => ({ data: [] }),
  })
})

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({ plugins: [], isLoading: false }),
  useFeaturedTriggersRecommendations: () => ({ plugins: [], isLoading: false }),
}))
vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined }),
}))
vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
  useInvalidateAllTriggerPlugins: () => vi.fn(),
}))

const mockUseAvailableBlocks = vi.mocked(useAvailableBlocks)
const mockUseNodeMetaData = vi.mocked(useNodeMetaData)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)

async function renderDropdownContent({
  showHelpLink = true,
  onClose = vi.fn(),
  data = {},
}: {
  showHelpLink?: boolean
  onClose?: () => void
  data?: Record<string, unknown>
} = {}) {
  const result = renderWorkflowFlowComponent(
    <NodeActionsDropdown
      id="node-1"
      data={{ type: BlockEnum.Code, title: 'Code Node', desc: '', ...data }}
      onOpenChange={(open) => !open && onClose()}
      showHelpLink={showHelpLink}
    />,
    {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      hooksStoreProps: {
        accessControl: {
          canEdit: true,
          canRun: true,
          canImportExportDSL: true,
          canReleaseAndVersion: true,
        },
        availableNodesMetaData: {
          nodes: [
            {
              metaData: {
                type: BlockEnum.HttpRequest,
                title: 'HTTP Request',
                classification: BlockClassification.Default,
                sort: 0,
                author: 'Dify',
                description: 'Send a request',
              },
              defaultValue: {},
              checkValid: () => ({ isValid: true }),
            },
          ],
        },
      },
      nodes: [
        {
          id: 'start',
          position: { x: 0, y: 0 },
          data: { type: BlockEnum.Start, title: 'Start', desc: '' },
        },
      ],
      edges: [{ id: 'edge-1', source: 'node-0', target: 'node-1', sourceHandle: 'branch-a' }],
    },
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
  return result
}

describe('node actions menu details', () => {
  const handleNodeChange = vi.fn()
  const handleNodeDelete = vi.fn()
  const handleNodesDuplicate = vi.fn()
  const handleNodeSelect = vi.fn()
  const handleNodesCopy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableBlocks.mockReturnValue({
      getAvailableBlocks: vi.fn(() => ({
        availablePrevBlocks: [BlockEnum.HttpRequest],
        availableNextBlocks: [BlockEnum.HttpRequest],
      })),
      availablePrevBlocks: [BlockEnum.HttpRequest],
      availableNextBlocks: [BlockEnum.HttpRequest],
    } as ReturnType<typeof useAvailableBlocks>)
    mockUseNodeMetaData.mockReturnValue({
      isTypeFixed: false,
      isSingleton: false,
      isUndeletable: false,
      description: 'Node description',
      author: 'Dify',
      helpLinkUri: 'https://docs.example.com/node',
    } as ReturnType<typeof useNodeMetaData>)
    mockUseNodesInteractions.mockReturnValue({
      handleNodeChange,
      handleNodeDelete,
      handleNodesDuplicate,
      handleNodeSelect,
      handleNodesCopy,
    } as unknown as ReturnType<typeof useNodesInteractions>)
    mockUseAllWorkflowTools.mockReturnValue({ data: [] })
  })

  it('keeps the menu after Escape and closes both surfaces after changing a node', async () => {
    const user = userEvent.setup()
    renderWorkflowFlowComponent(
      <NodeActionsDropdown
        id="node-1"
        data={{ type: BlockEnum.Code, title: 'Code Node', desc: '' }}
      />,
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: 'workflow',
        },
        hooksStoreProps: {
          accessControl: {
            canEdit: true,
            canRun: true,
            canImportExportDSL: true,
            canReleaseAndVersion: true,
          },
          availableNodesMetaData: {
            nodes: [
              {
                metaData: {
                  type: BlockEnum.HttpRequest,
                  title: 'HTTP Request',
                  classification: BlockClassification.Default,
                  sort: 0,
                  author: 'Dify',
                  description: 'Send a request',
                },
                defaultValue: {},
                checkValid: () => ({ isValid: true }),
              },
            ],
          },
        },
        nodes: [
          {
            id: 'start',
            position: { x: 0, y: 0 },
            data: { type: BlockEnum.Start, title: 'Start', desc: '' },
          },
        ],
        edges: [{ id: 'edge-1', source: 'node-0', target: 'node-1', sourceHandle: 'branch-a' }],
      },
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    const changeNode = screen.getByRole('menuitem', { name: 'workflow.panel.changeBlock' })
    await user.click(changeNode)
    const search = screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })
    await waitFor(() => expect(search).toHaveFocus())
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(`{${mod}>}cd{/${mod}}{Delete}`)
    const replacement = screen.getByRole('button', { name: 'HTTP Request' })
    act(() => replacement.focus())
    await user.keyboard(`{${mod}>}cd{/${mod}}{Delete}`)
    expect(handleNodesCopy).not.toHaveBeenCalled()
    expect(handleNodesDuplicate).not.toHaveBeenCalled()
    expect(handleNodeDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => search.focus())
    await user.keyboard('{ArrowDown}')
    expect(search).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(changeNode).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('button', { name: 'HTTP Request' }))

    expect(handleNodeChange).toHaveBeenCalledExactlyOnceWith(
      'node-1',
      BlockEnum.HttpRequest,
      'branch-a',
      undefined,
    )
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should run, copy, duplicate, delete, and expose the help link', async () => {
    const user = userEvent.setup()
    const { store } = await renderDropdownContent()

    await user.click(screen.getByText('workflow.panel.runThisStep'))
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('workflow.common.copy'))
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('workflow.common.duplicate'))
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('common.operation.delete'))

    expect(handleNodeSelect).toHaveBeenCalledWith('node-1')
    expect(store.getState().initShowLastRunTab).toBe(true)
    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'run' })
    expect(handleNodesCopy).toHaveBeenCalledWith('node-1')
    expect(handleNodesDuplicate).toHaveBeenCalledWith('node-1')
    expect(handleNodeDelete).toHaveBeenCalledWith('node-1')
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(screen.getByRole('menuitem', { name: 'workflow.panel.helpLink' })).toHaveAttribute(
      'href',
      'https://docs.example.com/node',
    )
  })

  it('should stop the current single run from the run action when the node is running', async () => {
    const user = userEvent.setup()
    const { store } = await renderDropdownContent({
      data: {
        _singleRunningStatus: NodeRunningStatus.Running,
      },
    })

    await user.click(screen.getByText('workflowDebug.debug.variableInspect.trigger.stop'))

    expect(handleNodeSelect).toHaveBeenCalledWith('node-1')
    expect(store.getState().initShowLastRunTab).toBe(true)
    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'stop' })
  })

  it('should hide change action when node is undeletable', async () => {
    mockUseNodeMetaData.mockReturnValue({
      isTypeFixed: false,
      isSingleton: true,
      isUndeletable: true,
      description: 'Undeletable node',
      author: 'Dify',
    } as ReturnType<typeof useNodeMetaData>)

    await renderDropdownContent({ showHelpLink: false })

    expect(screen.getByText('workflow.panel.runThisStep')).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'workflow.panel.changeBlock' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
  })

  it('links workflow tools to their app', async () => {
    mockUseAllWorkflowTools.mockReturnValue({
      data: [{ id: 'workflow-tool', workflow_app_id: 'app-123' }],
    })

    renderWorkflowFlowComponent(
      <NodeActionsDropdown
        id="node-2"
        data={{
          type: BlockEnum.Tool,
          title: 'Workflow Tool',
          desc: '',
          provider_type: 'workflow',
          provider_id: 'workflow-tool',
        }}
        showHelpLink={false}
      />,
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: 'workflow',
        },
        hooksStoreProps: {
          accessControl: {
            canEdit: true,
            canRun: true,
            canImportExportDSL: true,
            canReleaseAndVersion: true,
          },
          availableNodesMetaData: {
            nodes: [
              {
                metaData: {
                  type: BlockEnum.HttpRequest,
                  title: 'HTTP Request',
                  classification: BlockClassification.Default,
                  sort: 0,
                  author: 'Dify',
                  description: 'Send a request',
                },
                defaultValue: {},
                checkValid: () => ({ isValid: true }),
              },
            ],
          },
        },
        nodes: [
          {
            id: 'start',
            position: { x: 0, y: 0 },
            data: { type: BlockEnum.Start, title: 'Start', desc: '' },
          },
        ],
        edges: [],
      },
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.more' }))
    expect(screen.getByRole('menuitem', { name: 'workflow.panel.openWorkflow' })).toHaveAttribute(
      'href',
      '/app/app-123/workflow',
    )
  })

  it('removes editing and run actions when the canvas becomes readonly', async () => {
    const { store } = await renderDropdownContent()
    expect(screen.getByRole('menuitem', { name: 'workflow.panel.runThisStep' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /workflow.common.copy/ })).toBeInTheDocument()

    act(() => store.setState({ canvasReadOnly: true }))

    expect(
      screen.queryByRole('menuitem', { name: 'workflow.panel.runThisStep' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'workflow.panel.changeBlock' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /workflow.common.copy/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /common.operation.delete/ }),
    ).not.toBeInTheDocument()
  })
})
