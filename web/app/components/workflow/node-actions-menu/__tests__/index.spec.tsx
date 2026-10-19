import type { AvailableNodesMetaData } from '../../hooks-store'
import type { ToolNodeType } from '../../nodes/tool/types'
import type { Node } from '../../types'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { use, useLayoutEffect } from 'react'
import { useNodes } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { HooksStoreContext } from '../../hooks-store'
import { useNodeMetaData } from '../../hooks/use-nodes-meta-data'
import { useWorkflowNodeCatalog } from '../../node-catalog'
import { NodeActionsDropdown } from '../index'

// Node metadata comes from the per-app block registry, which has its own suite.
vi.mock('../../hooks/use-nodes-meta-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-meta-data')>()

  return {
    ...actual,
    useNodeMetaData: vi.fn(),
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.workflow.get': async () => [],
    }),
  }
})

vi.mock('../change-block-popup', () => ({
  ChangeBlockPopup: () => <div data-testid="node-actions-change-block" />,
}))

const mockUseNodeMetaData = vi.mocked(useNodeMetaData)

const toolProvider = createToolProviderFixture({
  id: 'provider-id',
  name: 'test-provider',
  allow_delete: true,
  team_credentials: {},
  is_team_authorization: false,
})
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

// Publishes the real block catalog so copy/duplicate know which nodes are copyable.
const CanvasNodes = () => {
  const catalog = useWorkflowNodeCatalog()
  const hooksStore = use(HooksStoreContext)!
  useLayoutEffect(() => {
    const nodesMap = catalog.nodesMap as NonNullable<AvailableNodesMetaData['nodesMap']>
    hooksStore.setState({
      availableNodesMetaData: {
        nodes: catalog.nodes.map((node) => nodesMap[node.metaData.type]),
        nodesMap,
      },
    })
  }, [catalog, hooksStore])
  const nodes = useNodes<{ selected?: boolean }>()
  return (
    <output aria-label="Canvas nodes">
      {nodes.map((node) => `${node.id}${node.data.selected ? '*' : ''}`).join(',')}
    </output>
  )
}
const canvasNodes = () => screen.getByRole('status', { name: 'Canvas nodes' }).textContent
const renderComponent = (
  showHelpLink: boolean = true,
  onOpenChange?: (open: boolean) => void,
  readOnly = false,
  data: Node['data'] = { title: 'Code Node', desc: '', type: BlockEnum.Code },
) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [toolProvider],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  return renderWorkflowFlowComponent(
    <>
      <NodeActionsDropdown
        id="node-1"
        data={data}
        triggerClassName="node-actions-trigger"
        onOpenChange={onOpenChange}
        showHelpLink={showHelpLink}
      />
      <CanvasNodes />
    </>,
    {
      initialStoreState: { canvasReadOnly: readOnly },
      nodes: [
        createNode({
          id: 'node-1',
          width: 240,
          height: 80,
          data,
        }),
      ],
      edges: [],
      queryClient,
    },
  )
}

describe('NodeActionsDropdown', () => {
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

    expect(canvasNodes()).toBe('node-1*')
    expect(store.getState().initShowLastRunTab).toBe(true)
    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'run' })
  })

  it('blocks a tool run in the menu when Workspace authorization is missing', async () => {
    const user = userEvent.setup()
    const { store } = renderComponent(true, undefined, false, makeToolData())
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
    expect(canvasNodes()).toBe('node-1')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('updates the open menu when the App user test connection is removed', async () => {
    const user = userEvent.setup()
    const { store } = renderComponent(true, undefined, false, makeToolData())
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
    expect(canvasNodes()).toBe('node-1')
  })

  it('keeps the menu stop action available when Workspace authorization is missing', async () => {
    const user = userEvent.setup()
    const { store } = renderComponent(
      true,
      undefined,
      false,
      makeToolData({ _singleRunningStatus: NodeRunningStatus.Running }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    const stop = screen.getByRole('menuitem', {
      name: 'workflowDebug.debug.variableInspect.trigger.stop',
    })

    expect(stop).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(stop)

    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'stop' })
    expect(canvasNodes()).toBe('node-1*')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each([
    { key: 'c', clipboard: ['node-1'], nodeCount: 1 },
    { key: 'd', clipboard: undefined, nodeCount: 2 },
    { key: 'Delete', clipboard: undefined, nodeCount: 0 },
    { key: 'Backspace', clipboard: undefined, nodeCount: 0 },
  ])('runs $key from the focused portalled node menu', async ({ key, clipboard, nodeCount }) => {
    const user = userEvent.setup()
    const { container, store } = renderComponent()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const focusedItem = document.activeElement
    expect(focusedItem).toHaveAttribute('role', 'menuitem')
    expect(container.contains(focusedItem)).toBe(false)

    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)

    if (clipboard)
      expect(store.getState().clipboardElements.map((node) => node.id)).toEqual(clipboard)
    expect(canvasNodes()!.split(',').filter(Boolean)).toHaveLength(nodeCount)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each([
    { name: /workflow\.common\.copy/, clipboard: ['node-1'], nodeCount: 1 },
    { name: /workflow\.common\.duplicate/, clipboard: undefined, nodeCount: 2 },
  ])('runs the $name menu item on click', async ({ name, clipboard, nodeCount }) => {
    const user = userEvent.setup()
    const { store } = renderComponent()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    await user.click(screen.getByRole('menuitem', { name }))

    if (clipboard)
      expect(store.getState().clipboardElements.map((node) => node.id)).toEqual(clipboard)
    expect(canvasNodes()!.split(',').filter(Boolean)).toHaveLength(nodeCount)
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
    expect(canvasNodes()).toBe('node-1')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('does not run unavailable editing shortcuts from a readonly node menu', async () => {
    const user = userEvent.setup()
    const { store } = renderComponent(true, undefined, true)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(`{${mod}>}cd{/${mod}}{Delete}`)
    expect(store.getState().clipboardElements).toEqual([])
    expect(canvasNodes()).toBe('node-1')
  })

  it('should hide single-run actions when nodes are readonly', async () => {
    const user = userEvent.setup()

    renderComponent(true, undefined, true)

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
