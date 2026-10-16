import type { AvailableNodesMetaData } from '../../hooks-store'
import type { Edge, Node } from '../../types'
import type { consoleClient } from '@/service/console'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { act, waitFor } from '@testing-library/react'
import { use, useLayoutEffect } from 'react'
import { useEdges, useNodes } from 'reactflow'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../__tests__/workflow-test-env'
import { WORKFLOW_COMMON_NODES } from '../../constants/node'
import { HooksStoreContext } from '../../hooks-store'
import { useWorkflowNodeCatalog } from '../../node-catalog'
import endDefault from '../../nodes/end/default'
import { BlockEnum } from '../../types'
import { writeWorkflowClipboard } from '../../utils/clipboard'
import { useNodesInteractions } from '../use-nodes-interactions'

const createAgent = vi.hoisted(() =>
  vi.fn<typeof consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put>(),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put': (input) =>
        createAgent(input),
    }),
  }
})

const workflowNode = (
  type: BlockEnum,
  id: string,
  overrides: Parameters<typeof createNode>[0] = {},
) => {
  const definition = [...WORKFLOW_COMMON_NODES, endDefault].find(
    (node) => node.metaData.type === type,
  )!
  return createNode({
    id,
    ...overrides,
    data: { ...definition.defaultValue, type, title: id, ...overrides.data },
  })
}
const codeNode = (id: string, overrides: Parameters<typeof createNode>[0] = {}) =>
  workflowNode(BlockEnum.Code, id, overrides)

// These commands are shared by the canvas, node menus, and keyboard handlers.
// Keep the graph, node catalog, clipboard codec, and history implementations real.
function useEditingCommands() {
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
  return {
    ...useNodesInteractions(),
    nodes: useNodes<Node['data']>(),
    edges: useEdges<Edge['data']>(),
  }
}
function setup({
  nodes = [codeNode('a'), codeNode('b'), codeNode('c')],
  edges = [],
  chatflow = false,
  readonly = false,
}: {
  nodes?: Node[]
  edges?: Edge[]
  chatflow?: boolean
  readonly?: boolean
} = {}) {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedAppDslVersion(queryClient, '1.0.0')
  const sync = vi.fn(async () => null)
  const rendered = renderWorkflowFlowHook(useEditingCommands, {
    nodes,
    edges,
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: chatflow ? 'advanced-chat' : 'workflow' },
    historyStore: { nodes, edges },
    initialStoreState: { canvasReadOnly: readonly },
    hooksStoreProps: { doSyncWorkflowDraft: sync },
  })
  return { ...rendered, sync }
}
async function paste(
  clipboardNodes: Node[],
  clipboardEdges: Edge[] = [],
  options: Parameters<typeof setup>[0] = {},
) {
  const test = setup(options)
  await writeWorkflowClipboard({ nodes: clipboardNodes, edges: clipboardEdges }, '1.0.0')
  await act(async () => test.result.current.handleNodesPaste())
  return test
}
beforeEach(async () => {
  createAgent.mockReset()
  await navigator.clipboard.writeText('')
})

it('selects a different node for inspection and clears the inspector selection', () => {
  const { result } = setup({
    nodes: [codeNode('a', { selected: true, data: { selected: true } }), codeNode('b')],
  })
  act(() => result.current.handleNodeSelect('b'))
  expect(result.current.nodes.map((node) => [node.id, node.selected, node.data.selected])).toEqual([
    ['a', false, false],
    ['b', true, true],
  ])
  act(() => result.current.handleNodesCancelSelected())
  expect(result.current.nodes.every((node) => !node.data.selected)).toBe(true)
})

it('connects nodes once, records the connection in history, and rejects cross-container links', async () => {
  const { result, store } = setup({
    nodes: [
      codeNode('a'),
      codeNode('b'),
      workflowNode(BlockEnum.Iteration, 'container'),
      codeNode('child', {
        parentId: 'container',
        data: { isInIteration: true, iteration_id: 'container' },
      }),
    ],
  })
  const connection = { source: 'a', sourceHandle: 'source', target: 'b', targetHandle: 'target' }
  act(() => {
    result.current.handleNodeConnect(connection)
    result.current.handleNodeConnect(connection)
    result.current.handleNodeConnect({ ...connection, target: 'child' })
  })
  expect(result.current.edges).toEqual([expect.objectContaining(connection)])
  expect(
    result.current.nodes.find((node) => node.id === 'a')?.data._connectedSourceHandleIds,
  ).toEqual(['source'])
  expect(
    result.current.nodes.find((node) => node.id === 'b')?.data._connectedTargetHandleIds,
  ).toEqual(['target'])
  await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
  act(() => result.current.handleHistoryBack())
  expect(result.current.edges).toEqual([])
  act(() => result.current.handleHistoryForward())
  expect(result.current.edges).toEqual([expect.objectContaining(connection)])
})

it.each(['delete', 'disconnect'] as const)(
  '%s removes only the affected connections and can be undone and redone',
  async (action) => {
    const nodes = [codeNode('a', { data: { selected: true } }), codeNode('b'), codeNode('c')]
    const edges = [
      createEdge({ id: 'a-b', source: 'a', target: 'b' }),
      createEdge({ id: 'b-c', source: 'b', target: 'c' }),
    ]
    const { result, store, sync } = setup({ nodes, edges })
    act(() => {
      if (action === 'delete') result.current.handleNodesDelete()
      else result.current.handleNodeDisconnect('a')
    })
    expect(result.current.edges.map((edge) => edge.id)).toEqual(['b-c'])
    expect(result.current.nodes.map((node) => node.id)).toEqual(
      action === 'delete' ? ['b', 'c'] : ['a', 'b', 'c'],
    )
    act(() => store.getState().flushPendingSync())
    expect(sync).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
    act(() => {
      store.setState({ canvasReadOnly: true })
      result.current.handleHistoryBack()
    })
    expect(result.current.edges.map((edge) => edge.id)).toEqual(['b-c'])
    act(() => {
      store.setState({ canvasReadOnly: false })
      result.current.handleHistoryBack()
    })
    expect(result.current.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c'])
    expect(result.current.edges.map((edge) => edge.id)).toEqual(['a-b', 'b-c'])
    act(() => {
      store.setState({ canvasReadOnly: true })
      result.current.handleHistoryForward()
    })
    expect(result.current.edges.map((edge) => edge.id)).toEqual(['a-b', 'b-c'])
    act(() => {
      store.setState({ canvasReadOnly: false })
      result.current.handleHistoryForward()
    })
    expect(result.current.edges.map((edge) => edge.id)).toEqual(['b-c'])
  },
)

it('preserves graph and clipboard when editing commands run on a readonly canvas', async () => {
  const nodes = [codeNode('a', { data: { selected: true } }), codeNode('b')]
  const edges = [createEdge({ source: 'a', target: 'b' })]
  const { result, store, sync } = setup({ nodes, edges, readonly: true })
  const initialNodes = result.current.nodes
  const initialEdges = result.current.edges
  await act(async () => {
    result.current.handleNodesCopy()
    await result.current.handleNodesPaste()
    result.current.handleNodesDelete()
    result.current.handleNodeDisconnect('a')
    store.getState().flushPendingSync()
  })
  expect(result.current.nodes).toEqual(initialNodes)
  expect(result.current.edges).toEqual(initialEdges)
  expect(await navigator.clipboard.readText()).toBe('')
  expect(sync).not.toHaveBeenCalled()
})

it('saves resize dimensions in undo history', async () => {
  const { result, store } = setup({
    nodes: [
      workflowNode(BlockEnum.Iteration, 'a', {
        data: { type: BlockEnum.Iteration, _children: [] },
        position: { x: 10, y: 20 },
        width: 100,
        height: 80,
      }),
    ],
  })
  act(() =>
    result.current.handleNodeResize('a', {
      x: 30,
      y: 40,
      width: 260,
      height: 140,
      direction: [1, 1],
    }),
  )
  expect(result.current.nodes[0]).toMatchObject({
    position: { x: 30, y: 40 },
    width: 260,
    height: 140,
    data: { width: 260, height: 140 },
  })
  await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
  act(() => result.current.handleHistoryBack())
  expect(result.current.nodes[0]).toMatchObject({
    position: { x: 10, y: 20 },
    width: 100,
    height: 80,
  })
  act(() => result.current.handleHistoryForward())
  expect(result.current.nodes[0]).toMatchObject({ width: 260, height: 140 })
  act(() => {
    store.setState({ canvasReadOnly: true })
    result.current.handleNodeResize('a', { x: 0, y: 0, width: 500, height: 500, direction: [1, 1] })
  })
  expect(result.current.nodes[0]).toMatchObject({
    position: { x: 30, y: 40 },
    width: 260,
    height: 140,
  })
})

it('copies selected nodes with their internal connections and pastes an independent graph', async () => {
  const nodes = [
    codeNode('a', { data: { _isBundled: true } }),
    codeNode('b', { data: { _isBundled: true } }),
    codeNode('c'),
  ]
  const edges = [
    createEdge({ id: 'a-b', source: 'a', target: 'b' }),
    createEdge({ id: 'b-c', source: 'b', target: 'c' }),
  ]
  const { result } = setup({ nodes, edges })
  act(() => result.current.handleNodesCopy())
  const copied = JSON.parse(await navigator.clipboard.readText())
  expect(copied.nodes.map((node: Node) => node.id)).toEqual(['a', 'b'])
  expect(copied.edges.map((edge: Edge) => edge.id)).toEqual(['a-b'])
  await act(async () => result.current.handleNodesPaste())
  const added = result.current.nodes.filter(
    (node) => !nodes.some((original) => original.id === node.id),
  )
  expect(added.map((node) => node.data.title)).toEqual(['a (1)', 'b (1)'])
  expect(result.current.edges).toContainEqual(
    expect.objectContaining({ source: added[0]!.id, target: added[1]!.id }),
  )
  expect(result.current.edges).toHaveLength(3)
})

it.each([
  { titles: ['Existing'], expected: 'Clipboard' },
  { titles: ['Clipboard', 'Clipboard (1)'], expected: 'Clipboard (2)' },
])('resolves pasted names against existing titles $titles', async ({ titles, expected }) => {
  const { result } = await paste([codeNode('clipboard', { data: { title: 'Clipboard' } })], [], {
    nodes: titles.map((title, index) => codeNode(`existing-${index}`, { data: { title } })),
  })
  expect(result.current.nodes.find((node) => !node.id.startsWith('existing-'))?.data.title).toBe(
    expected,
  )
})

const memory = {
  window: { enabled: false, size: 50 },
  query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
}
const promptTemplate = [{ role: 'user', text: '{{#start.query#}}' }]
it.each(
  [
    BlockEnum.LLM,
    BlockEnum.QuestionClassifier,
    BlockEnum.ParameterExtractor,
    BlockEnum.Agent,
  ].flatMap((type) => [
    { type, chatflow: false },
    { type, chatflow: true },
  ]),
)(
  'preserves $type memory only when pasting into chatflow=$chatflow',
  async ({ type, chatflow }) => {
    const source = workflowNode(type, 'source', {
      data: { type, memory, prompt_template: promptTemplate },
    })
    const { result } = await paste([source], [], { nodes: [], chatflow })
    const added = result.current.nodes[0]!
    if (chatflow) expect(added.data).toHaveProperty('memory', memory)
    else expect(added.data).not.toHaveProperty('memory')
    expect(added.data).toHaveProperty('prompt_template', promptTemplate)
    expect(source.data).toHaveProperty('memory', memory)
  },
)

it.each([BlockEnum.Iteration, BlockEnum.Loop])(
  'copies a selected %s and its children without nesting the pasted container into itself',
  async (type) => {
    const parent = workflowNode(type, 'parent', {
      selected: true,
      data: { type, selected: true, _children: [{ nodeId: 'child', nodeType: BlockEnum.LLM }] },
    })
    const child = workflowNode(BlockEnum.LLM, 'child', {
      parentId: 'parent',
      data: { type: BlockEnum.LLM, memory, prompt_template: promptTemplate },
    })
    const { result } = setup({ nodes: [parent, child] })
    act(() => result.current.handleNodesCopy('parent'))
    await act(async () => result.current.handleNodesPaste())
    const addedParent = result.current.nodes.find(
      (node) => node.id !== 'parent' && node.data.type === type,
    )!
    const addedChild = result.current.nodes.find(
      (node) => node.id !== 'child' && node.data.type === BlockEnum.LLM,
    )!
    expect(addedParent.parentId).toBeUndefined()
    expect(addedChild.parentId).toBe(addedParent.id)
    expect(addedChild.data).not.toHaveProperty('memory')
    expect(child.data).toHaveProperty('memory', memory)
  },
)

it.each([BlockEnum.End, BlockEnum.Iteration, BlockEnum.Loop])(
  'rejects pasting %s into an iteration',
  async (type) => {
    const parent = workflowNode(BlockEnum.Iteration, 'parent', {
      selected: true,
      data: { type: BlockEnum.Iteration, _children: [] },
    })
    const { result } = await paste([workflowNode(type, 'source')], [], {
      nodes: [parent],
    })
    expect(result.current.nodes.map((node) => node.id)).toEqual(['parent'])
  },
)
it.each([BlockEnum.Iteration, BlockEnum.Loop])(
  'pastes human input into a %s with the correct parent relationship',
  async (type) => {
    const parent = workflowNode(type, 'parent', { selected: true })
    const { result } = await paste([workflowNode(BlockEnum.HumanInput, 'source')], [], {
      nodes: [parent],
    })
    const child = result.current.nodes.find((node) => node.id !== 'parent')!
    expect(child.parentId).toBe('parent')
    expect(child.data).toMatchObject({
      isInIteration: type === BlockEnum.Iteration,
      isInLoop: type === BlockEnum.Loop,
    })
    expect(result.current.nodes[0]!.data._children).toContainEqual({
      nodeId: child.id,
      nodeType: BlockEnum.HumanInput,
    })
  },
)

it('creates an inline Agent through the service boundary and resolves the pending graph node', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof createAgent>>>()
  createAgent.mockReturnValue(request.promise)
  const { result, store, sync } = setup()
  act(() => result.current.handleNodeAdd({ nodeType: BlockEnum.AgentV2 }, { prevNodeId: 'a' }))
  await waitFor(() => expect(createAgent).toHaveBeenCalledTimes(1))
  const nodeId = createAgent.mock.lastCall![0].params.node_id
  expect(result.current.nodes.find((node) => node.id === nodeId)?.data._isTempNode).toBe(true)
  expect(store.getState().openInlineAgentPanelNodeId).toBe(nodeId)
  expect(createAgent.mock.lastCall![0]).toMatchObject({
    params: { app_id: 'app-1' },
    body: {
      variant: 'workflow',
      binding: { binding_type: 'inline_agent' },
      save_strategy: 'node_job_only',
    },
  })
  await act(async () =>
    request.resolve(
      zWorkflowAgentComposerResponse.parse({
        variant: 'workflow',
        agent_soul: { schema_version: 1, prompt: { system_prompt: '' } },
        node_job: {},
        save_options: [],
        soul_lock: { locked: false },
        binding: {
          id: 'binding-1',
          node_id: nodeId,
          workflow_id: 'workflow-1',
          binding_type: 'inline_agent',
          agent_id: 'inline-agent-1',
          current_snapshot_id: 'snapshot-1',
        },
      }),
    ),
  )
  await waitFor(() =>
    expect(result.current.nodes.find((node) => node.id === nodeId)?.data).toMatchObject({
      agent_binding: {
        binding_type: 'inline_agent',
        agent_id: 'inline-agent-1',
        current_snapshot_id: 'snapshot-1',
      },
    }),
  )
  expect(result.current.nodes.find((node) => node.id === nodeId)?.data._isTempNode).toBeUndefined()
  expect(sync).toHaveBeenCalledTimes(2)
})
