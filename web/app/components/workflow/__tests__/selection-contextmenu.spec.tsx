import type { Edge, Node } from '../types'
import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useNodes } from 'reactflow'
import { PipelineInputVarType } from '@/models/pipeline'
import { SelectionContextmenu } from '../selection-contextmenu'
import { useWorkflowStore } from '../store'
import { BlockEnum } from '../types'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { createEdge, createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

let latestNodes: Node[] = []
let latestHistoryEvent: string | undefined
const mockGetNodesReadOnly = vi.fn()
const mockHandleNodesCopy = vi.fn()
const mockHandleNodesDuplicate = vi.fn()
const mockHandleNodesDelete = vi.fn()
const mockHandleCreateSnippet = vi.fn()
const mockPostDraft = vi.fn()
const mockPush = vi.fn()
const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['snippets.create_and_modify'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }))
})

vi.mock('@/service/use-snippets', () => ({
  useCreateSnippetMutation: () => ({ mutateAsync: mockHandleCreateSnippet, isPending: false }),
}))
vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    snippets: {
      bySnippetId: {
        workflows: { draft: { post: (...args: unknown[]) => mockPostDraft(...args) } },
      },
    },
  },
}))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-workflow')>()
  return {
    ...actual,
    useNodesReadOnly: () => ({
      getNodesReadOnly: mockGetNodesReadOnly,
    }),
  }
})

vi.mock('../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-nodes-interactions')>()
  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodesCopy: mockHandleNodesCopy,
      handleNodesDuplicate: mockHandleNodesDuplicate,
      handleNodesDelete: mockHandleNodesDelete,
    }),
  }
})

const RuntimeProbe = () => {
  latestNodes = useNodes() as Node[]
  const { store } = useWorkflowHistoryStore()

  useEffect(() => {
    latestHistoryEvent = store.getState().workflowHistoryEvent
    return store.subscribe((state) => {
      latestHistoryEvent = state.workflowHistoryEvent
    })
  }, [store])

  return null
}

const hooksStoreProps = {
  doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
}

const SelectionMenuHarness = () => {
  const workflowStore = useWorkflowStore()

  return (
    <ContextMenu open>
      <SelectionContextmenu
        onClose={() => workflowStore.getState().setContextMenuTarget(undefined)}
      />
    </ContextMenu>
  )
}

const renderSelectionMenu = (options?: {
  nodes?: Node[]
  edges?: Edge[]
  initialStoreState?: Record<string, unknown>
}) => {
  latestNodes = []
  latestHistoryEvent = undefined

  const nodes = options?.nodes ?? []
  const edges = options?.edges ?? []

  return renderWorkflowFlowComponent(
    <div id="workflow-container" style={{ width: 800, height: 600 }}>
      <RuntimeProbe />
      <SelectionMenuHarness />
    </div>,
    {
      nodes,
      edges,
      hooksStoreProps,
      historyStore: { nodes, edges },
      initialStoreState: options?.initialStoreState,
      reactFlowProps: { fitView: false },
    },
  )
}

describe('SelectionContextmenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestNodes = []
    latestHistoryEvent = undefined
    mockGetNodesReadOnly.mockReset()
    mockGetNodesReadOnly.mockReturnValue(false)
    mockHandleNodesCopy.mockReset()
    mockHandleNodesDuplicate.mockReset()
    mockHandleNodesDelete.mockReset()
    mockHandleCreateSnippet.mockReset().mockResolvedValue({ id: 'created-snippet' })
    mockPostDraft.mockResolvedValue({})
    mockWorkspacePermissionKeys.value = ['snippets.create_and_modify']
  })

  it.each([
    { key: 'c', action: mockHandleNodesCopy },
    { key: 'd', action: mockHandleNodesDuplicate },
    { key: 'Delete', action: mockHandleNodesDelete },
  ])('runs $key for the menu selection and closes the menu', async ({ key, action }) => {
    const user = userEvent.setup()
    renderSelectionMenu({
      nodes: [createNode({ id: 'n1', selected: true }), createNode({ id: 'n2', selected: true })],
      initialStoreState: { contextMenuTarget: { type: 'selection' } },
    })
    const item = await screen.findByRole('menuitem', { name: /common.copy/ })
    act(() => item.focus())
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should not render when selection context menu target is absent', () => {
    renderSelectionMenu()

    expect(screen.queryByText('operator.vertical')).not.toBeInTheDocument()
  })

  it('should render menu items when selection context menu target is present', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
    ]
    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /operator.alignLeft/ })).toBeInTheDocument()
    })
  })

  it('should render and execute copy/duplicate/delete operations', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
    ]
    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /common.copy/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /common.copy/ }))
    expect(mockHandleNodesCopy).toHaveBeenCalledTimes(1)
    expect(store.getState().contextMenuTarget).toBeUndefined()

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /common.duplicate/ }))
    expect(mockHandleNodesDuplicate).toHaveBeenCalledTimes(1)
    expect(store.getState().contextMenuTarget).toBeUndefined()

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /operation.delete/ }))
    expect(mockHandleNodesDelete).toHaveBeenCalledTimes(1)
    expect(store.getState().contextMenuTarget).toBeUndefined()
  })

  it('should open create snippet dialog with selected graph from the top menu item', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
      createNode({ id: 'n3', selected: false, position: { x: 260, y: 0 }, width: 80, height: 40 }),
    ]
    const edges = [
      createEdge({ source: 'n1', target: 'n2' }),
      createEdge({ source: 'n2', target: 'n3' }),
    ]
    const { store } = renderSelectionMenu({ nodes, edges })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Create Snippet|snippet\.createDialogTitle/ }),
    )

    expect(
      screen.getByRole('dialog', { name: 'workflow.snippet.createDialogTitle' }),
    ).toBeInTheDocument()
    expect(store.getState().contextMenuTarget).toBeUndefined()

    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' }), 'Selection')
    await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.snippet.confirm' }))
    await waitFor(() => expect(mockHandleCreateSnippet).toHaveBeenCalledOnce())
    const payload = mockHandleCreateSnippet.mock.calls[0]![0].body
    expect(payload.graph.nodes.map((node: Node) => node.id)).toEqual(['n1', 'n2'])
    expect(payload.graph.nodes.every((node: Node) => node.selected === false)).toBe(true)
    expect(payload.graph.edges).toHaveLength(1)
    expect(payload.graph.viewport).toEqual({ x: 490, y: 380, zoom: 1 })
    expect(payload.graph.edges[0]).toEqual(
      expect.objectContaining({
        source: 'n1',
        target: 'n2',
        selected: false,
      }),
    )
  })

  it('should hide create snippet action without snippets create-and-modify permission', async () => {
    mockWorkspacePermissionKeys.value = []
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 80, height: 40 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
    ]
    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /common.copy/ })).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('menuitem', { name: /Create Snippet|snippet\.createDialogTitle/ }),
    ).not.toBeInTheDocument()
  })

  it('should add input fields for variable references outside of the selected graph', async () => {
    const nodes = [
      createNode({
        id: 'n1',
        selected: true,
        width: 80,
        height: 40,
        data: {
          prompt_template: 'Use {{#source-node.topic#}} and {{#n2.answer#}}',
          query_variable_selector: ['source-node', 'topic'],
          env_reference: '{{#env.API_KEY#}}',
        },
      }),
      createNode({
        id: 'n2',
        selected: true,
        position: { x: 140, y: 0 },
        width: 80,
        height: 40,
      }),
    ]
    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Create Snippet|snippet\.createDialogTitle/ }),
    )

    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' }), 'Selection')
    await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.snippet.confirm' }))
    await waitFor(() => expect(mockHandleCreateSnippet).toHaveBeenCalledOnce())
    const payload = mockHandleCreateSnippet.mock.calls[0]![0].body
    expect(payload.input_fields).toEqual([
      {
        label: 'topic',
        variable: 'topic',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'API_KEY',
        variable: 'API_KEY',
        type: PipelineInputVarType.textInput,
        required: true,
      },
    ])
    expect(payload.graph.nodes[0].data.prompt_template).toBe(
      'Use {{#start.topic#}} and {{#n2.answer#}}',
    )
    expect(payload.graph.nodes[0].data.query_variable_selector).toEqual(['start', 'topic'])
    expect(payload.graph.nodes[0].data.env_reference).toBe('{{#start.API_KEY#}}')
  })

  it.each([BlockEnum.Answer, BlockEnum.End, BlockEnum.Start])(
    'should hide create snippet when selection contains %s node',
    async (nodeType) => {
      const nodes = [
        createNode({ id: 'n1', selected: true, width: 80, height: 40, data: { type: nodeType } }),
        createNode({ id: 'n2', selected: true, position: { x: 140, y: 0 }, width: 80, height: 40 }),
      ]
      const { store } = renderSelectionMenu({ nodes })

      act(() => {
        store.setState({ contextMenuTarget: { type: 'selection' } })
      })

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: /common.copy/ })).toBeInTheDocument()
      })
      expect(
        screen.queryByRole('menuitem', { name: /Create Snippet|snippet\.createDialogTitle/ }),
      ).not.toBeInTheDocument()
    },
  )

  it('should stay hidden when only one node is selected', async () => {
    const nodes = [createNode({ id: 'n1', selected: true, width: 80, height: 40 })]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('should align selected nodes to the left and save history', async () => {
    vi.useFakeTimers()
    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 20, y: 40 }, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 90 }, width: 60, height: 30 }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
      edges: [createEdge({ source: 'n1', target: 'n2' })],
      initialStoreState: {
        helpLineHorizontal: { y: 10 } as never,
        helpLineVertical: { x: 10 } as never,
      },
    })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(latestNodes.find((node) => node.id === 'n1')?.position.x).toBe(20)
    expect(latestNodes.find((node) => node.id === 'n2')?.position.x).toBe(20)
    expect(store.getState().contextMenuTarget).toBeUndefined()
    expect(store.getState().helpLineHorizontal).toBeUndefined()
    expect(store.getState().helpLineVertical).toBeUndefined()

    act(() => {
      store.getState().flushPendingSync()
      vi.advanceTimersByTime(600)
    })

    expect(hooksStoreProps.doSyncWorkflowDraft).toHaveBeenCalled()
    expect(latestHistoryEvent).toBe('NodeDragStop')
    vi.useRealTimers()
  })

  it('should distribute selected nodes horizontally', async () => {
    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 0, y: 10 }, width: 20, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 100, y: 20 }, width: 20, height: 20 }),
      createNode({ id: 'n3', selected: true, position: { x: 300, y: 30 }, width: 20, height: 20 }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
    })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /operator.distributeHorizontal/ }))

    expect(latestNodes.find((node) => node.id === 'n2')?.position.x).toBe(150)
  })

  it('should ignore child nodes when the selected container is aligned', async () => {
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        position: { x: 200, y: 0 },
        width: 100,
        height: 80,
        data: { _children: [{ nodeId: 'child', nodeType: 'code' as never }] },
      }),
      createNode({
        id: 'child',
        selected: true,
        position: { x: 210, y: 10 },
        width: 30,
        height: 20,
      }),
      createNode({
        id: 'other',
        selected: true,
        position: { x: 40, y: 60 },
        width: 40,
        height: 20,
      }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
    })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(latestNodes.find((node) => node.id === 'container')?.position.x).toBe(40)
    expect(latestNodes.find((node) => node.id === 'other')?.position.x).toBe(40)
    expect(latestNodes.find((node) => node.id === 'child')?.position.x).toBe(210)
  })

  it('should cancel when align bounds cannot be resolved', () => {
    const nodes = [
      createNode({ id: 'n1', selected: true }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 } }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(store.getState().contextMenuTarget).toBeUndefined()
  })

  it('should cancel without aligning when nodes are read only', () => {
    mockGetNodesReadOnly.mockReturnValue(true)
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 }, width: 40, height: 20 }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(store.getState().contextMenuTarget).toBeUndefined()
    expect(latestNodes.find((node) => node.id === 'n1')?.position.x).toBe(0)
    expect(latestNodes.find((node) => node.id === 'n2')?.position.x).toBe(80)
  })

  it('should cancel when alignable nodes shrink to one item', () => {
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        width: 40,
        height: 20,
        data: { _children: [{ nodeId: 'child', nodeType: 'code' as never }] },
      }),
      createNode({
        id: 'child',
        selected: true,
        position: { x: 80, y: 20 },
        width: 40,
        height: 20,
      }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    fireEvent.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(store.getState().contextMenuTarget).toBeUndefined()
    expect(latestNodes.find((node) => node.id === 'container')?.position.x).toBe(0)
    expect(latestNodes.find((node) => node.id === 'child')?.position.x).toBe(80)
  })
})
