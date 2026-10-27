import type { ReactFlowInstance } from 'reactflow'
import type { SnippetWorkflow } from '@/types/snippet'
import { act, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRef, useImperativeHandle } from 'react'
import { useReactFlow } from 'reactflow'
import WorkflowWithDefaultContext, { Workflow } from '@/app/components/workflow'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { useSnippetDraftStore } from '../../draft-store'
import { useSnippetRefreshDraft } from '../use-snippet-refresh-draft'

const { fetchDraft } = vi.hoisted(() => ({
  fetchDraft: vi.fn<() => Promise<SnippetWorkflow | undefined>>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/snippets/snippet-1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/use-snippet-workflows', () => ({ fetchSnippetDraftWorkflow: fetchDraft }))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchAllInspectVars: async () => [],
}))

const initialFields = [
  {
    type: PipelineInputVarType.textInput,
    label: 'Query',
    variable: 'query',
    required: true,
  },
]
const localNodes = [
  createStartNode({
    id: 'local',
    width: 240,
    height: 100,
    data: { title: 'Local draft', variables: [] },
  }),
]
const localViewport = { x: 80, y: 60, zoom: 0.8 }

function setup() {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: false },
    appDslVersion: '0.6.0',
  })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  const refresh = createRef<ReturnType<typeof useSnippetRefreshDraft>>()
  const flow = createRef<ReactFlowInstance>()
  function Refresh() {
    const hook = useSnippetRefreshDraft('snippet-1')
    const canvas = useReactFlow()
    useImperativeHandle(refresh, () => hook, [hook])
    useImperativeHandle(flow, () => canvas, [canvas])
    return null
  }
  // Mount the production event subscriber: emitting an update must replace the displayed graph.
  const view = renderWorkflowComponent(
    <NuqsTestingAdapter>
      <EventEmitterContextProvider>
        <WorkflowWithDefaultContext nodes={localNodes} edges={[]}>
          <Workflow nodes={localNodes} edges={[]} viewport={localViewport}>
            <Refresh />
          </Workflow>
        </WorkflowWithDefaultContext>
      </EventEmitterContextProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
      initialStoreState: { syncWorkflowDraftHash: 'existing-hash', draftUpdatedAt: 1000 },
    },
  )
  return { ...view, refresh, flow }
}

beforeEach(() => {
  fetchDraft.mockReset()
  useSnippetDraftStore.getState().setInputFields(initialFields)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

it('keeps syncing until the draft arrives, then replaces canvas, fields and version state', async () => {
  const pending = createDeferred<SnippetWorkflow>()
  const draft: SnippetWorkflow = {
    id: 'draft-1',
    graph: {
      nodes: [
        createStartNode({
          id: 'saved',
          width: 240,
          height: 100,
          data: { title: 'Saved draft', variables: [] },
        }),
      ],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 1.2 },
    },
    features: {},
    input_fields: [],
    hash: 'draft-hash',
    created_at: 1_712_300_000,
    updated_at: 1_712_345_678,
  }
  fetchDraft.mockReturnValueOnce(pending.promise)
  const onSuccess = vi.fn()
  const { refresh, flow, store } = setup()
  expect(await screen.findByText('Local draft')).toBeInTheDocument()

  act(() => refresh.current!.handleRefreshWorkflowDraft(onSuccess))
  expect(store.getState().isSyncingWorkflowDraft).toBe(true)
  expect(onSuccess).not.toHaveBeenCalled()
  expect(useSnippetDraftStore.getState().inputFields).toEqual(initialFields)
  expect(flow.current!.getNodes().map((node) => node.id)).toEqual(['local'])
  await act(async () => pending.resolve(draft))

  expect(await screen.findByText('Saved draft')).toBeInTheDocument()
  expect(screen.queryByText('Local draft')).not.toBeInTheDocument()
  await waitFor(() => expect(flow.current!.getViewport()).toEqual(draft.graph.viewport))
  expect(flow.current!.getNodes()).toMatchObject([
    {
      id: 'saved',
      data: { title: 'Saved draft', _connectedSourceHandleIds: [], _connectedTargetHandleIds: [] },
    },
  ])
  expect(store.getState().isSyncingWorkflowDraft).toBe(false)
  expect(fetchDraft).toHaveBeenCalledExactlyOnceWith('snippet-1')
  expect(useSnippetDraftStore.getState().inputFields).toEqual([])
  expect(store.getState().syncWorkflowDraftHash).toBe('draft-hash')
  expect(store.getState().draftUpdatedAt).toBe(1_712_345_678_000)
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith(draft)
})

it('finishes without replacing editor state when no draft exists yet', async () => {
  fetchDraft.mockResolvedValueOnce(undefined)
  const onSuccess = vi.fn()
  const { refresh, flow, store } = setup()
  expect(await screen.findByText('Local draft')).toBeInTheDocument()
  act(() => refresh.current!.handleRefreshWorkflowDraft(onSuccess))
  await waitFor(() => expect(store.getState().isSyncingWorkflowDraft).toBe(false))

  expect(flow.current!.getNodes()).toMatchObject(localNodes)
  expect(flow.current!.getViewport()).toEqual(localViewport)
  expect(screen.getByText('Local draft')).toBeInTheDocument()
  expect(useSnippetDraftStore.getState().inputFields).toEqual(initialFields)
  expect(store.getState().syncWorkflowDraftHash).toBe('existing-hash')
  expect(store.getState().draftUpdatedAt).toBe(1000)
  expect(onSuccess).not.toHaveBeenCalled()
})
