import type { AgentV2NodeType } from '../../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes, useStoreApi } from 'reactflow'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import { ErrorHandleTypeEnum } from '../../../_base/components/error-handle/types'
import { AgentOutputRoutes } from '../agent-output-routes'

const accepted = { id: 'accepted', name: 'Accept', label: 'Accepted' }
const rejected = { id: 'rejected', name: 'Reject', label: 'Rejected' }
const deferred = { id: 'deferred', name: 'Defer', label: 'Deferred' }
const title = 'workflow.nodes.agent.outputRoutes.title'
const createData = (overrides: Partial<AgentV2NodeType> = {}): AgentV2NodeType => ({
  type: BlockEnum.AgentV2,
  title: 'Agent',
  desc: '',
  version: '2',
  agent_node_kind: 'dify_agent',
  agent_output_routes: { enabled: true, routes: [accepted, rejected] },
  ...overrides,
})

function setup({ data = createData(), connected = false, readonly = false } = {}) {
  let flow: ReturnType<typeof useStoreApi>
  function RoutesEditor() {
    flow = useStoreApi()
    const agent = useNodes<AgentV2NodeType>().find((node) => node.id === 'agent')
    const { handleHistoryBack } = useNodesInteractions()
    return agent ? (
      <>
        <AgentOutputRoutes id={agent.id} data={agent.data} />
        <button type="button" onClick={handleHistoryBack}>
          Undo
        </button>
      </>
    ) : null
  }
  const sourceHandle = data.agent_output_routes?.enabled ? 'accepted' : 'source'
  const nodes = [
    createStartNode({ id: 'start', data: { variables: [] } }),
    createNode({
      id: 'agent',
      data: {
        ...data,
        _targetBranches: data.agent_output_routes?.enabled
          ? data.agent_output_routes.routes?.map((item) => ({ id: item.id, name: item.name ?? '' }))
          : [],
        _connectedSourceHandleIds: connected ? [sourceHandle] : [],
      },
    }),
    createNode({
      id: 'end',
      data: {
        type: BlockEnum.End,
        title: 'End',
        outputs: [
          { variable: 'result', value_selector: ['agent', 'text'] },
          ...(data.agent_output_routes?.enabled
            ? [{ variable: 'route', value_selector: ['agent', 'switch'] }]
            : []),
        ],
        _connectedTargetHandleIds: connected ? ['target'] : [],
      },
    }),
  ]
  const edges = [
    createEdge({ id: 'start-agent', source: 'start', target: 'agent' }),
    ...(connected
      ? [
          createEdge({
            id: 'agent-end',
            source: 'agent',
            sourceHandle,
            target: 'end',
            targetHandle: 'target',
            data: { sourceType: BlockEnum.AgentV2, targetType: BlockEnum.End },
          }),
        ]
      : []),
  ]
  const sync = vi.fn(async () => null)
  const result = renderWorkflowEditor(
    <EventEmitterContextProvider>
      <RoutesEditor />
    </EventEmitterContextProvider>,
    {
      nodes,
      edges,
      historyStore: { nodes, edges },
      initialStoreState: { canvasReadOnly: readonly },
      hooksStoreProps: { doSyncWorkflowDraft: sync },
    },
  )
  return {
    ...result,
    sync,
    user: userEvent.setup(),
    nodeData: () =>
      flow
        .getState()
        .getNodes()
        .find((node) => node.id === 'agent')!.data as AgentV2NodeType,
    endData: () =>
      flow
        .getState()
        .getNodes()
        .find((node) => node.id === 'end')!.data,
    edges: () => flow.getState().edges.map((edge) => edge.id),
  }
}
const route = (name: string) => within(screen.getByRole('group', { name }))
const toggle = () => screen.getByRole('switch', { name: title })

it('keeps a saved route and its edited condition through enabling, disabling, and re-enabling', async () => {
  const { user, nodeData, edges, store, sync } = setup({
    connected: true,
    data: createData({ agent_output_routes: { enabled: false, routes: [accepted] } }),
  })
  await user.click(toggle())
  expect(nodeData().agent_output_routes?.routes).toEqual([
    accepted,
    expect.objectContaining({ id: expect.any(String), name: '' }),
  ])
  expect(nodeData().agent_output_routes?.routes?.[1]?.id).not.toBe(accepted.id)
  expect(edges()).toEqual(['start-agent'])
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
  await replacePromptEditorText(route('Accepted').getByRole('textbox'), 'Request approved')
  await waitFor(() =>
    expect(nodeData().agent_output_routes?.routes?.[0]?.name).toBe('Request approved'),
  )
  const savedRoutes = nodeData().agent_output_routes?.routes
  await user.click(toggle())
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(nodeData()._targetBranches).toEqual([])
  await user.click(toggle())
  expect(route('Accepted').getByRole('textbox')).toHaveTextContent('Request approved')
  expect(nodeData().agent_output_routes?.routes).toEqual(savedRoutes)
  expect(nodeData()._targetBranches?.map((branch) => branch.id)).toEqual(
    savedRoutes?.map((item) => item.id),
  )
  act(() => store.getState().flushPendingSync())
  expect(sync).toHaveBeenCalled()
})

it('removes the chosen route and connection, keeps switch references, and restores both with one undo', async () => {
  const { user, nodeData, endData, edges, store } = setup({
    connected: true,
    data: createData({
      agent_output_routes: { enabled: true, routes: [accepted, rejected, deferred] },
    }),
  })
  await user.click(route('Accepted').getByRole('button', { name: 'common.operation.remove' }))
  expect(screen.queryByRole('group', { name: 'Accepted' })).not.toBeInTheDocument()
  expect(nodeData().agent_output_routes?.routes).toEqual([rejected, deferred])
  expect(nodeData()._targetBranches).toEqual([
    { id: 'rejected', name: 'Reject' },
    { id: 'deferred', name: 'Defer' },
  ])
  expect(edges()).toEqual(['start-agent'])
  expect(endData().outputs).toContainEqual({
    variable: 'route',
    value_selector: ['agent', 'switch'],
  })
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
  await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(route('Accepted').getByRole('textbox')).toHaveTextContent('Accept')
  expect(nodeData().agent_output_routes?.routes).toEqual([accepted, rejected, deferred])
  expect(edges()).toEqual(['start-agent', 'agent-end'])
})

it.each([false, true])(
  'disables routes and restores them with one undo, with an outgoing connection: %s',
  async (connected) => {
    const { user, nodeData, endData, edges, store } = setup({ connected })
    await user.click(toggle())
    expect(toggle()).not.toBeChecked()
    expect(edges()).toEqual(['start-agent'])
    if (connected)
      expect(endData().outputs).not.toContainEqual({
        variable: 'route',
        value_selector: ['agent', 'switch'],
      })
    await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(toggle()).toBeChecked()
    expect(nodeData().agent_output_routes?.routes).toEqual([accepted, rejected])
    expect(route('Accepted').getByRole('textbox')).toHaveTextContent('Accept')
    if (connected) {
      expect(edges()).toEqual(['start-agent', 'agent-end'])
      expect(endData().outputs).toContainEqual({
        variable: 'route',
        value_selector: ['agent', 'switch'],
      })
    }
  },
)

it('collapses the route editor without disabling routes or losing the condition', async () => {
  const { user, nodeData } = setup()
  const disclosure = screen.getByRole('button', { name: new RegExp(title) })
  await user.click(disclosure)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(toggle()).toBeChecked()
  expect(nodeData().agent_output_routes?.enabled).toBe(true)
  await user.click(disclosure)
  expect(route('Accepted').getByRole('textbox')).toHaveTextContent('Accept')
})

it('clears incompatible default values when enabling output routes', async () => {
  const { user, nodeData } = setup({
    data: createData({
      agent_output_routes: undefined,
      error_strategy: ErrorHandleTypeEnum.defaultValue,
      default_value: [{ key: 'text', type: VarType.string, value: 'fallback' }],
    }),
  })
  await user.click(toggle())
  expect(nodeData()).toMatchObject({
    agent_output_routes: { enabled: true },
    error_strategy: undefined,
    default_value: undefined,
  })
})

it('keeps routes and connections unchanged on a readonly canvas', async () => {
  const { user, nodeData, edges } = setup({ readonly: true, connected: true })
  const before = nodeData()
  expect(toggle()).toHaveAttribute('aria-disabled', 'true')
  await user.click(toggle())
  expect(nodeData()).toEqual(before)
  expect(edges()).toEqual(['start-agent', 'agent-end'])
})
