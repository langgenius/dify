import type { Shape as HooksStore } from '../hooks-store/store'
import type { AgentV2NodeType } from '../nodes/agent-v2/types'
import type { Node } from '../types'
import type { consoleClient } from '@/service/console'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStoreApi } from 'reactflow'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import CandidateNodeMain from '../candidate-node-main'
import { WORKFLOW_COMMON_NODES } from '../constants/node'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import agentDefault from '../nodes/agent-v2/default'
import webhookDefault from '../nodes/trigger-webhook/default'
import { useOperator } from '../operator/hooks'
import { useStore } from '../store'
import { BlockEnum } from '../types'
import { createNode } from './fixtures'

const { webhook, createBinding } = vi.hoisted(() => ({
  webhook: vi.fn<typeof consoleClient.apps.byAppId.workflows.triggers.webhook.get>(),
  createBinding:
    vi.fn<typeof consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggers.get': async () => [],
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.triggers.webhook.get': webhook,
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put': createBinding,
      'agent.byAgentId.get': async () => createAgentFixture({ id: 'agent-1' }),
    }),
  }
})

const candidate = (type: BlockEnum, id = 'candidate') => {
  const definition = [...WORKFLOW_COMMON_NODES, webhookDefault].find(
    (node) => node.metaData.type === type,
  )!
  return createNode({
    id,
    data: { ...definition.defaultValue, type, title: 'Candidate', _isCandidate: true },
  })
}
const inlineCandidate = (overrides: Partial<AgentV2NodeType> = {}) =>
  createNode({
    id: 'inline-agent',
    data: {
      ...agentDefault.defaultValue,
      type: BlockEnum.Agent,
      title: 'Inline agent',
      _isCandidate: true,
      ...overrides,
    },
  })

function setup(candidateNode?: Node) {
  let flow: ReturnType<typeof useStoreApi>
  function Canvas() {
    flow = useStoreApi()
    const pending = useStore((state) => state.candidateNode)
    const { handleHistoryBack } = useNodesInteractions()
    const { handleAddNote } = useOperator()
    return (
      <>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleAddNote()
          }}
        >
          Add note
        </button>
        <button type="button" onClick={handleHistoryBack}>
          Undo
        </button>
        <section aria-label="Workflow canvas">
          {pending && <CandidateNodeMain candidateNode={pending} />}
        </section>
      </>
    )
  }
  const initialNodes = [candidate(BlockEnum.Code, 'existing-node')]
  initialNodes[0]!.data._isCandidate = false
  const sync = vi.fn<HooksStore['doSyncWorkflowDraft']>(async (_force, callbacks) => {
    callbacks?.onSuccess?.()
  })
  const result = renderWorkflowEditor(
    <EventEmitterContextProvider>
      <Canvas />
    </EventEmitterContextProvider>,
    {
      nodes: initialNodes,
      edges: [],
      historyStore: { nodes: initialNodes, edges: [] },
      initialStoreState: {
        candidateNode,
        mousePosition: { pageX: 100, pageY: 200, elementX: 30, elementY: 40 },
      },
      reactFlowProps: { fitView: false, defaultViewport: { x: 0, y: 0, zoom: 1 } },
      hooksStoreProps: { doSyncWorkflowDraft: sync },
    },
  )
  const user = userEvent.setup()
  return {
    ...result,
    sync,
    user,
    place: () => user.click(screen.getByRole('region', { name: 'Workflow canvas' })),
    nodes: () => flow.getState().getNodes(),
  }
}

beforeEach(() => {
  webhook.mockReset().mockResolvedValue({
    id: 'hook-1',
    node_id: 'webhook',
    webhook_id: 'webhook-1',
    webhook_url: 'https://example.com/webhook',
    webhook_debug_url: 'https://example.com/debug',
  })
  createBinding.mockReset()
})

it('places one webhook and generates its URL only after the draft is saved', async () => {
  const request = createDeferred()
  const { user, store, sync, place, nodes } = setup(candidate(BlockEnum.TriggerWebhook, 'webhook'))
  sync.mockImplementationOnce(async (_force, callbacks) => {
    await request.promise
    callbacks?.onSuccess?.()
  })
  await place()
  expect(store.getState().candidateNode).toBeUndefined()
  expect(nodes().find((node) => node.id === 'webhook')).toMatchObject({
    position: { x: 100, y: 200 },
    data: { _isCandidate: false, webhook_url: '' },
  })
  expect(sync).toHaveBeenCalledOnce()
  expect(webhook).not.toHaveBeenCalled()
  await act(async () => request.resolve())
  await waitFor(() =>
    expect(nodes().find((node) => node.id === 'webhook')?.data).toMatchObject({
      webhook_url: 'https://example.com/webhook',
      webhook_debug_url: 'https://example.com/debug',
    }),
  )
  expect(webhook).toHaveBeenCalledWith({
    params: { app_id: 'app-1' },
    query: { node_id: 'webhook' },
  })
  await place()
  expect(nodes().map((node) => node.id)).toEqual(['existing-node', 'webhook'])
  await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(nodes().map((node) => node.id)).toEqual(['existing-node'])
})

it('selects a placed note and can undo its insertion', async () => {
  const { user, store, place, nodes } = setup()
  await user.click(screen.getByRole('button', { name: 'Add note' }))
  const noteId = store.getState().candidateNode!.id
  await place()
  expect(nodes().find((node) => node.id === noteId)).toMatchObject({
    selected: true,
    data: { selected: true, text: '', _isCandidate: false },
  })
  await waitFor(() => expect(store.temporal.getState().pastStates).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(nodes().map((node) => node.id)).toEqual(['existing-node'])
})

it('keeps a roster binding when placing an agent without creating an inline agent', async () => {
  const { place, nodes, sync } = setup(
    inlineCandidate({
      agent_binding: { binding_type: 'roster_agent', agent_id: 'agent-1' },
    }),
  )
  await place()
  expect(nodes().find((node) => node.id === 'inline-agent')?.data).toMatchObject({
    agent_binding: { binding_type: 'roster_agent', agent_id: 'agent-1' },
    _isCandidate: false,
  })
  expect(sync).toHaveBeenCalledOnce()
  expect(createBinding).not.toHaveBeenCalled()
})

it.each(['success', 'failure'] as const)(
  'settles a temporary inline agent after the binding request %s',
  async (outcome) => {
    const request =
      createDeferred<
        Awaited<
          ReturnType<
            typeof consoleClient.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put
          >
        >
      >()
    createBinding.mockReturnValue(request.promise)
    const { store, place, nodes, sync } = setup(inlineCandidate())
    await place()
    expect(createBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-1', node_id: 'inline-agent' },
        body: expect.objectContaining({
          variant: 'workflow',
          binding: { binding_type: 'inline_agent' },
          save_strategy: 'node_job_only',
        }),
      }),
    )
    expect(nodes().find((node) => node.id === 'inline-agent')?.data).toMatchObject({
      _isTempNode: true,
      selected: true,
    })
    expect(store.getState().openInlineAgentPanelNodeId).toBe('inline-agent')
    if (outcome === 'failure') {
      await act(async () => request.reject(new Error('Unavailable')))
      await waitFor(() => expect(nodes().map((node) => node.id)).toEqual(['existing-node']))
      return
    }
    const binding = {
      binding_type: 'inline_agent',
      agent_id: 'bound-agent',
      current_snapshot_id: 'snapshot',
    }
    await act(async () =>
      request.resolve(
        zWorkflowAgentComposerResponse.parse({
          variant: 'workflow',
          agent_soul: { schema_version: 1, prompt: { system_prompt: '' } },
          node_job: {},
          save_options: [],
          soul_lock: { locked: false },
          binding: {
            ...binding,
            id: 'binding-1',
            node_id: 'inline-agent',
            workflow_id: 'workflow-1',
          },
        }),
      ),
    )
    await waitFor(() =>
      expect(nodes().find((node) => node.id === 'inline-agent')?.data).toMatchObject({
        agent_binding: binding,
      }),
    )
    expect(nodes().find((node) => node.id === 'inline-agent')?.data._isTempNode).toBeUndefined()
    expect(sync).toHaveBeenCalledTimes(2)
  },
)

it.each([
  [BlockEnum.Iteration, BlockEnum.IterationStart, 'isInIteration'],
  [BlockEnum.Loop, BlockEnum.LoopStart, 'isInLoop'],
] as const)('places a %s with its required start node', async (type, startType, flag) => {
  const { place, nodes } = setup(candidate(type))
  await place()
  expect(nodes()).toHaveLength(3)
  expect(nodes()).toContainEqual(
    expect.objectContaining({
      parentId: 'candidate',
      data: expect.objectContaining({ type: startType, [flag]: true }),
    }),
  )
})

it('cancels placement without changing the graph or history', async () => {
  const { user, store, nodes, sync } = setup(candidate(BlockEnum.Code))
  await user.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('region', { name: 'Workflow canvas' }),
  })
  expect(store.getState().candidateNode).toBeUndefined()
  expect(nodes().map((node) => node.id)).toEqual(['existing-node'])
  expect(store.temporal.getState().pastStates).toHaveLength(0)
  expect(sync).not.toHaveBeenCalled()
})
