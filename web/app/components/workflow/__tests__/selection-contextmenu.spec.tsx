import type { Edge, Node } from '../types'
import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { useEdges, useNodes } from 'reactflow'
import { PipelineInputVarType } from '@/models/pipeline'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { fullWorkflowAccessControl } from '../hooks-store'
import { SelectionContextmenu } from '../selection-contextmenu'
import { useWorkflowStore } from '../store'
import { BlockEnum } from '../types'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { CanvasNodesCatalogProbe } from './canvas-nodes-catalog-probe'
import { createEdge, createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

let latestNodes: Node[] = []
let latestEdges: Edge[] = []
let latestHistoryEvent: string | undefined
const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['snippets.create_and_modify'] as string[],
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// The dialog form is independently tested; keep this boundary focused on the prepared graph.
vi.mock('@/app/components/snippets/create-snippet-dialog', () => ({
  CreateSnippetDialog: (props: {
    isOpen: boolean
    selectedGraph?: {
      nodes: Node[]
      edges: Edge[]
      viewport: { x: number; y: number; zoom: number }
    }
    inputFields?: Array<{ variable: string }>
  }) =>
    props.isOpen ? (
      <section role="dialog" aria-label="Create snippet">
        <output aria-label="Selected snippet graph">{JSON.stringify(props.selectedGraph)}</output>
        <output aria-label="Snippet input fields">{JSON.stringify(props.inputFields ?? [])}</output>
      </section>
    ) : null,
}))

const RuntimeProbe = () => {
  latestNodes = useNodes() as Node[]
  latestEdges = useEdges() as Edge[]
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
  accessControl: fullWorkflowAccessControl,
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
  latestEdges = []
  latestHistoryEvent = undefined

  const nodes = options?.nodes ?? []
  const edges = options?.edges ?? []

  const { queryClient } = createConsoleQueryWrapper({
    appDslVersion: '1.0.0',
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })

  return renderWorkflowFlowComponent(
    <div id="workflow-container" style={{ width: 800, height: 600 }}>
      <RuntimeProbe />
      <CanvasNodesCatalogProbe />
      <SelectionMenuHarness />
    </div>,
    {
      nodes,
      edges,
      hooksStoreProps,
      queryClient,
      historyStore: { nodes, edges },
      initialStoreState: options?.initialStoreState,
      reactFlowProps: { fitView: false },
    },
  )
}

describe('SelectionContextmenu', () => {
  beforeEach(() => {
    latestNodes = []
    latestEdges = []
    latestHistoryEvent = undefined
    mockWorkspacePermissionKeys.value = ['snippets.create_and_modify']
  })

  const createSelectedGraph = () => ({
    nodes: [
      createNode({
        id: 'n1',
        selected: true,
        width: 80,
        height: 40,
        data: { selected: true, _isBundled: true },
      }),
      createNode({
        id: 'n2',
        selected: true,
        position: { x: 140, y: 0 },
        width: 80,
        height: 40,
        data: { selected: true, _isBundled: true },
      }),
    ],
    edges: [createEdge({ id: 'n1-n2', source: 'n1', target: 'n2' })],
  })

  const expectGraphAction = async (
    action: 'copy' | 'duplicate' | 'delete',
    store: ReturnType<typeof renderSelectionMenu>['store'],
  ) => {
    if (action === 'copy') {
      expect(store.getState().clipboardElements.map((node) => node.id)).toEqual(['n1', 'n2'])
      expect(store.getState().clipboardEdges.map((edge) => edge.id)).toEqual(['n1-n2'])
      expect(latestNodes).toHaveLength(2)
      expect(latestEdges).toHaveLength(1)
      return
    }

    if (action === 'duplicate') {
      await waitFor(() => expect(latestNodes).toHaveLength(4))
      expect(latestEdges).toHaveLength(2)
      expect(latestNodes.map((node) => node.id)).toEqual(expect.arrayContaining(['n1', 'n2']))
      expect(latestEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'n1-n2', source: 'n1', target: 'n2' }),
        ]),
      )
      const duplicatedNodeIds = latestNodes
        .filter((node) => !['n1', 'n2'].includes(node.id))
        .map((node) => node.id)
      const duplicatedEdge = latestEdges.find(
        (edge) => edge.source !== 'n1' || edge.target !== 'n2',
      )
      expect(duplicatedNodeIds).toHaveLength(2)
      expect(duplicatedEdge).toBeDefined()
      expect(new Set([duplicatedEdge!.source, duplicatedEdge!.target])).toEqual(
        new Set(duplicatedNodeIds),
      )
      return
    }

    await waitFor(() => expect(latestNodes).toHaveLength(0))
    expect(latestEdges).toHaveLength(0)
  }

  it.each([
    { key: 'c', action: 'copy' as const },
    { key: 'd', action: 'duplicate' as const },
    { key: 'Delete', action: 'delete' as const },
  ])('runs $key on the selected graph and closes the menu', async ({ key, action }) => {
    const user = userEvent.setup()
    const graph = createSelectedGraph()
    const { store } = renderSelectionMenu({
      ...graph,
      initialStoreState: { contextMenuTarget: { type: 'selection' } },
    })
    const item = await screen.findByRole('menuitem', { name: /common.copy/ })
    act(() => item.focus())
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'

    await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)

    await expectGraphAction(action, store)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should not render when selection context menu target is absent', () => {
    renderSelectionMenu()

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each([
    { name: /common.copy/, action: 'copy' as const },
    { name: /common.duplicate/, action: 'duplicate' as const },
    { name: /operation.delete/, action: 'delete' as const },
  ])('runs the $action menu item on the selected graph', async ({ name, action }) => {
    const user = userEvent.setup()
    const graph = createSelectedGraph()
    const { store } = renderSelectionMenu({
      ...graph,
      initialStoreState: { contextMenuTarget: { type: 'selection' } },
    })

    await user.click(await screen.findByRole('menuitem', { name }))

    await expectGraphAction(action, store)
    expect(store.getState().contextMenuTarget).toBeUndefined()
  })

  it('should open create snippet dialog with selected graph from the top menu item', async () => {
    const user = userEvent.setup()
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

    await user.click(
      await screen.findByRole('menuitem', { name: /Create Snippet|snippet\.createDialogTitle/ }),
    )

    expect(screen.getByRole('dialog', { name: 'Create snippet' })).toBeInTheDocument()
    expect(store.getState().contextMenuTarget).toBeUndefined()

    const selectedGraph = JSON.parse(
      screen.getByLabelText('Selected snippet graph').textContent ?? '{}',
    ) as { nodes: Node[]; edges: Edge[]; viewport: { x: number; y: number; zoom: number } }
    expect(selectedGraph.nodes.map((node) => node.id)).toEqual(['n1', 'n2'])
    expect(selectedGraph.nodes.every((node) => node.selected === false)).toBe(true)
    expect(selectedGraph.edges).toHaveLength(1)
    expect(selectedGraph.viewport).toEqual({ x: 490, y: 380, zoom: 1 })
    expect(selectedGraph.edges[0]).toEqual(
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
    const user = userEvent.setup()
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

    await user.click(
      await screen.findByRole('menuitem', { name: /Create Snippet|snippet\.createDialogTitle/ }),
    )

    const inputFields = JSON.parse(
      screen.getByLabelText('Snippet input fields').textContent ?? '[]',
    ) as Array<{ label: string; variable: string; type: PipelineInputVarType; required: boolean }>
    expect(inputFields).toEqual([
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
    const selectedGraph = JSON.parse(
      screen.getByLabelText('Selected snippet graph').textContent ?? '{}',
    ) as {
      nodes: Array<
        Node & {
          data: Node['data'] & {
            prompt_template: string
            query_variable_selector: string[]
            env_reference: string
          }
        }
      >
    }
    const snippetData = selectedGraph.nodes[0]!.data
    expect(snippetData.prompt_template).toBe('Use {{#start.topic#}} and {{#n2.answer#}}')
    expect(snippetData.query_variable_selector).toEqual(['start', 'topic'])
    expect(snippetData.env_reference).toBe('{{#start.API_KEY#}}')
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
    const user = userEvent.setup()
    const nodes = [
      createNode({ id: 'n1', selected: true, position: { x: 20, y: 40 }, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 140, y: 90 }, width: 60, height: 30 }),
    ]

    const { store } = renderSelectionMenu({
      nodes,
      edges: [createEdge({ source: 'n1', target: 'n2' })],
      initialStoreState: {
        helpLineHorizontal: { top: 10, left: 0, width: 100 },
        helpLineVertical: { top: 0, left: 10, height: 100 },
      },
    })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    await user.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(latestNodes.find((node) => node.id === 'n1')?.position.x).toBe(20)
    expect(latestNodes.find((node) => node.id === 'n2')?.position.x).toBe(20)
    expect(store.getState().contextMenuTarget).toBeUndefined()
    expect(store.getState().helpLineHorizontal).toBeUndefined()
    expect(store.getState().helpLineVertical).toBeUndefined()

    act(() => {
      store.getState().flushPendingSync()
    })

    expect(hooksStoreProps.doSyncWorkflowDraft).toHaveBeenCalled()
    await waitFor(() => expect(latestHistoryEvent).toBe('NodeDragStop'))
  })

  it('should distribute selected nodes horizontally', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('menuitem', { name: /operator.distributeHorizontal/ }))

    expect(latestNodes.find((node) => node.id === 'n2')?.position.x).toBe(150)
  })

  it('should ignore child nodes when the selected container is aligned', async () => {
    const user = userEvent.setup()
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        position: { x: 200, y: 0 },
        width: 100,
        height: 80,
        data: { _children: [{ nodeId: 'child', nodeType: BlockEnum.Code }] },
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

    await user.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(latestNodes.find((node) => node.id === 'container')?.position.x).toBe(40)
    expect(latestNodes.find((node) => node.id === 'other')?.position.x).toBe(40)
    expect(latestNodes.find((node) => node.id === 'child')?.position.x).toBe(210)
  })

  it('should cancel when align bounds cannot be resolved', async () => {
    const user = userEvent.setup()
    const nodes = [
      createNode({ id: 'n1', selected: true }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 } }),
    ]

    const { store } = renderSelectionMenu({ nodes })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    await user.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(store.getState().contextMenuTarget).toBeUndefined()
    expect(latestNodes.map(({ id, position }) => ({ id, position }))).toEqual(
      nodes.map(({ id, position }) => ({ id, position })),
    )
  })

  it('should cancel without aligning when nodes are read only', async () => {
    const user = userEvent.setup()
    const nodes = [
      createNode({ id: 'n1', selected: true, width: 40, height: 20 }),
      createNode({ id: 'n2', selected: true, position: { x: 80, y: 20 }, width: 40, height: 20 }),
    ]

    const { store } = renderSelectionMenu({ nodes, initialStoreState: { canvasReadOnly: true } })

    act(() => {
      store.setState({ contextMenuTarget: { type: 'selection' } })
    })

    await user.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(store.getState().contextMenuTarget).toBeUndefined()
    expect(latestNodes.find((node) => node.id === 'n1')?.position.x).toBe(0)
    expect(latestNodes.find((node) => node.id === 'n2')?.position.x).toBe(80)
  })

  it('should cancel when alignable nodes shrink to one item', async () => {
    const user = userEvent.setup()
    const nodes = [
      createNode({
        id: 'container',
        selected: true,
        width: 40,
        height: 20,
        data: { _children: [{ nodeId: 'child', nodeType: BlockEnum.Code }] },
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

    await user.click(screen.getByRole('menuitem', { name: /operator.alignLeft/ }))

    expect(store.getState().contextMenuTarget).toBeUndefined()
    expect(latestNodes.find((node) => node.id === 'container')?.position.x).toBe(0)
    expect(latestNodes.find((node) => node.id === 'child')?.position.x).toBe(80)
  })
})
