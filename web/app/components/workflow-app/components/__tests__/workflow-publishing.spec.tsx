import type { QueryClient } from '@tanstack/react-query'
import type { Features } from '@/app/components/base/features/types'
import type { InjectWorkflowStoreSliceFn, Shape } from '@/app/components/workflow/store'
import type { Edge, Node } from '@/app/components/workflow/types'
import { ORPCError } from '@orpc/client'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { CollectionType } from '@/app/components/tools/types'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import agentDefault from '@/app/components/workflow/nodes/agent-v2/default'
import codeDefault from '@/app/components/workflow/nodes/code/default'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createMutationInvalidation } from '@/service/console/mutation-invalidation'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedAppDetail,
  seedAppDslVersion,
} from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { AppACLPermission } from '@/utils/permission'
import { createWorkflowSlice } from '../../store/workflow/workflow-slice'
import WorkflowMain from '../workflow-main'

const api = vi.hoisted(() => ({
  save: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.post>(),
  publish:
    vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.publish.post>(),
  createTool:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.workflow.create.post
    >(),
  toolDetail:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.workflow.get.get
    >(),
  app: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.get>(),
  published:
    vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.publish.get>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/app-1/workflow',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const { createAgentFixture } = await import('@/test/fixtures/agent')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.publish.post': api.publish,
      'apps.byAppId.get': api.app,
      'workspaces.current.toolProvider.workflow.get.get': api.toolDetail,
      'workspaces.current.tools.workflow.get': async () => [],
      'apps.byAppId.workflows.publish.get': api.published,
      'apps.byAppId.workflows.draft.environmentVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.conversationVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.systemVariables.get': async () => ({ items: [] }),
      'apps.byAppId.triggers.get': async () => ({ data: [] }),
      'enterprise.appDeploy.deploymentService.listAppEnvironments': async () => ({ data: [] }),
      'codeBasedExtension.get': async () => undefined,
      // Refetched by the invalidation fallback after a publish.
      'agent.byAgentId.get': async () => createAgentFixture(),
      'agent.byAgentId.referencingWorkflows.get': async () => ({ data: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.post': api.save,
      'workspaces.current.toolProvider.workflow.create.post': api.createTool,
      'apps.byAppId.workflows.draft.variables.get': async () => ({ items: [], total: 0 }),
      'apps.byAppId.workflow.comments.get': async () => ({ data: [] }),
    }),
  }
})

beforeEach(() => {
  api.save.mockReset().mockResolvedValue({ result: 'success', hash: 'saved-hash', updated_at: 2 })
  api.publish.mockReset().mockResolvedValue({ result: 'success', created_at: 1704067200 })
  api.published.mockReset().mockResolvedValue(createWorkflowResponseFixture())
  api.app.mockReset()
  api.createTool.mockReset().mockResolvedValue({ result: 'success' })
  api.toolDetail.mockReset().mockResolvedValue({
    workflow_app_id: 'app-1',
    workflow_tool_id: 'tool-1',
    name: 'workflow_tool',
    label: 'Workflow app',
    description: '',
    icon: { content: '🔧', background: '#ffffff' },
    synced: true,
    parameters: [],
    tool: {
      name: 'workflow_tool',
      label: { en_US: 'Workflow app' },
      description: { en_US: '' },
      author: 'Dify',
      parameters: [
        {
          name: '__image',
          label: { en_US: 'files' },
          type: 'files',
          form: 'llm',
          required: false,
          multiple: false,
        },
      ],
    },
  })
})
afterEach(async () => {
  await act(async () => cleanup())
  vi.restoreAllMocks()
})

const validGraph = (mode: 'workflow' | 'advanced-chat' = 'workflow') => ({
  nodes: [
    createStartNode({ id: 'start', data: { title: 'User input', variables: [] } }),
    createNode({
      id: 'code',
      position: { x: 300, y: 0 },
      data: {
        ...codeDefault.defaultValue,
        title: 'Prepare response',
        code: 'def main():\n    return {"answer": "Hello"}',
        outputs: { answer: { type: VarType.string } },
      },
    }),
    createNode({
      id: 'end',
      position: { x: 600, y: 0 },
      data: {
        title: 'Response',
        ...(mode === 'workflow'
          ? {
              type: BlockEnum.End,
              outputs: [
                {
                  variable: 'answer',
                  value_type: VarType.string,
                  value_selector: ['code', 'answer'],
                },
              ],
            }
          : { type: BlockEnum.Answer, answer: '{{#code.answer#}}' }),
      },
    }),
  ],
  edges: [
    createEdge({ source: 'start', target: 'code', sourceHandle: 'source', targetHandle: 'target' }),
    createEdge({
      source: 'code',
      target: 'end',
      sourceHandle: 'source',
      targetHandle: 'target',
      data: {
        sourceType: BlockEnum.Code,
        targetType: mode === 'workflow' ? BlockEnum.End : BlockEnum.Answer,
      },
    }),
  ],
})

function renderEditor({
  mode = 'workflow',
  graph = validGraph(mode),
  features = {},
  initialStoreState = {},
  permissions = Object.values(AppACLPermission),
  seedQueries,
  workflowKind = 'standard',
  withInvalidation = false,
}: {
  mode?: 'workflow' | 'advanced-chat'
  graph?: { nodes: Node[]; edges: Edge[] }
  features?: Features
  initialStoreState?: Partial<Shape>
  seedQueries?: (queryClient: QueryClient) => void
  permissions?: NonNullable<ReturnType<typeof createAppDetailFixture>['permission_keys']>
  workflowKind?: ReturnType<typeof createAppDetailFixture>['workflow_kind']
  /** Runs the app's mutation invalidation fallback on the test client. */
  withInvalidation?: boolean
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    ...(withInvalidation && {
      queryClient: createConsoleQueryClient({ invalidation: createMutationInvalidation() }),
    }),
    systemFeatures: {
      deployment_edition: 'CLOUD',
      enable_marketplace: false,
      webapp_auth: { enabled: false },
    },
    features: {
      billing: { subscription: { plan: 'sandbox' } },
      evaluation_enabled: false,
      evaluation_upgrade_available: false,
    },
    workspacePermissionKeys: ['tool.manage'],
  })
  const app = createAppDetailFixture({
    id: 'app-1',
    name: 'Workflow app',
    mode,
    permission_keys: permissions,
    workflow_kind: workflowKind,
  })
  seedAppDetail(queryClient, app)
  api.app.mockResolvedValue(app)
  seedAppDslVersion(queryClient)
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
  seedQueries?.(queryClient)
  const view = renderWorkflowComponent(
    <NuqsTestingAdapter>
      <EventEmitterContextProvider>
        <FeaturesProvider features={features}>
          <WorkflowWithDefaultContext nodes={graph.nodes} edges={graph.edges}>
            <WorkflowMain
              nodes={graph.nodes}
              edges={graph.edges}
              viewport={{ x: 0, y: 0, zoom: 1 }}
            />
          </WorkflowWithDefaultContext>
        </FeaturesProvider>
      </EventEmitterContextProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode },
      initialStoreState: {
        isWorkflowDataLoaded: true,
        publishedAt: 1700000000000,
        lastPublishedHasUserInput: true,
        ...initialStoreState,
      },
      injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
    },
  )
  return { ...view, queryClient }
}

const trigger = () => screen.getByRole('button', { name: 'workflow.common.publish' })
async function openPublisher(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  const publish = await screen.findByRole('button', { name: /workflow.common.publishUpdate/ })
  await waitFor(() => expect(api.save).toHaveBeenCalled())
  return publish
}

it('opens and closes the real chatflow feature drawer', async () => {
  const user = userEvent.setup()
  renderEditor({ mode: 'advanced-chat' })
  await user.click(screen.getByRole('button', { name: 'workflow.common.features' }))
  const drawer = await screen.findByRole('dialog', { name: 'workflow.common.features' })
  await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'workflow.common.features' }),
    ).not.toBeInTheDocument(),
  )
})

it('keeps chatflow feature editing unavailable on a read-only canvas', async () => {
  const user = userEvent.setup()
  renderEditor({ mode: 'advanced-chat', permissions: [AppACLPermission.ViewLayout] })
  await user.click(screen.getByRole('button', { name: 'workflow.common.features' }))
  expect(screen.queryByRole('dialog', { name: 'workflow.common.features' })).not.toBeInTheDocument()
  expect(trigger()).toBeDisabled()
})

it('does not offer chat features in a workflow and disables publishing an empty graph', () => {
  renderEditor({ graph: { nodes: [], edges: [] } })
  expect(screen.queryByRole('button', { name: 'workflow.common.features' })).not.toBeInTheDocument()
  expect(trigger()).toBeDisabled()
})

it('disables republishing an evaluation workflow when Evaluation is unavailable', async () => {
  const user = userEvent.setup()
  renderEditor({ workflowKind: 'evaluation' })

  expect(await openPublisher(user)).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'workflow.common.switchToStandardWorkflow' }),
  ).not.toBeInTheDocument()
})

it('saves once when opening the publisher and does not save again when closing it', async () => {
  const user = userEvent.setup()
  renderEditor()
  await openPublisher(user)
  await waitFor(() => expect(api.save).toHaveBeenCalledOnce())
  await user.click(trigger())
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /workflow.common.publishUpdate/ }),
    ).not.toBeInTheDocument(),
  )
  expect(api.save).toHaveBeenCalledOnce()
})

it('waits for the current graph to save before publishing and updates the publication state', async () => {
  const user = userEvent.setup()
  const { store } = renderEditor()
  const publish = await openPublisher(user)
  const saved = createDeferred<Awaited<ReturnType<typeof api.save>>>()
  api.save.mockReturnValueOnce(saved.promise)
  await user.click(publish)
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2))
  expect(api.save.mock.lastCall?.[0].body.graph).toMatchObject({
    nodes: [{ id: 'start' }, { id: 'code' }, { id: 'end' }],
  })
  expect(api.publish).not.toHaveBeenCalled()
  await act(async () => saved.resolve({ result: 'success', hash: 'latest', updated_at: 3 }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
  )
  expect(api.publish).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1' },
    body: { marked_name: '', marked_comment: '' },
  })
  expect(store.getState()).toMatchObject({
    publishedAt: 1704067200000,
    lastPublishedHasUserInput: true,
  })
})

it('keeps publishing available for retry when saving the draft fails', async () => {
  const user = userEvent.setup()
  renderEditor()
  const publish = await openPublisher(user)
  api.save.mockRejectedValueOnce(new Error('Save unavailable'))
  await user.click(publish)
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2))
  expect(api.publish).not.toHaveBeenCalled()
  await user.click(publish)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
  )
  expect(api.publish).toHaveBeenCalledOnce()
})

it('rejects an incomplete code node through the real checklist', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  const graph = validGraph()
  graph.nodes[1] = createNode({ ...graph.nodes[1], data: { ...graph.nodes[1]!.data, code: '' } })
  renderEditor({ graph })
  await user.click(await openPublisher(user))
  await waitFor(() => expect(error).toHaveBeenCalledWith('workflow.panel.checklistTip'))
  expect(api.publish).not.toHaveBeenCalled()
})

it('rejects checklist warnings without changing the current App user authorization errors', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  const graph = validGraph()
  graph.nodes.push(
    createNode({
      id: 'tool-1',
      data: {
        type: BlockEnum.Tool,
        provider_type: CollectionType.builtIn,
        provider_id: 'provider-1',
        provider_name: 'provider-1',
        tool_name: 'search',
        tool_parameters: {},
        tool_configurations: {},
      },
    }),
  )
  graph.edges.push(createEdge({ source: 'code', target: 'tool-1' }))
  const { store } = renderEditor({
    graph,
    seedQueries(queryClient) {
      seedToolProviders(queryClient, {
        builtInTools: [
          createToolProviderFixture({
            id: 'provider-1',
            name: 'provider-1',
            allow_delete: true,
            is_team_authorization: false,
          }),
        ],
      })
    },
  })
  act(() => {
    store.getState().setNodeAppUserAuthDraft('tool-1', 'provider-1', 'provider-1', {
      oauthEnabled: true,
      apiKeyEnabled: false,
      description: '',
    })
    store.getState().setNodeAuthorizationTab('tool-1', 'provider-1', 'provider-1', 'app-user-auth')
  })
  const errorsBeforePublish = structuredClone(store.getState().nodeAuthDrafts['tool-1']?.errors)
  expect(errorsBeforePublish).toBeDefined()
  await user.click(await openPublisher(user))
  await waitFor(() => expect(error).toHaveBeenCalledWith('workflow.panel.checklistTip'))
  expect(store.getState().nodeAuthDrafts['tool-1']?.errors).toEqual(errorsBeforePublish)
  expect(api.save).toHaveBeenCalledOnce()
  expect(api.publish).not.toHaveBeenCalled()
})

it('shows the server advisory instead of a success toast after publishing', async () => {
  const user = userEvent.setup()
  const warning = vi.spyOn(toast, 'warning')
  const success = vi.spyOn(toast, 'success')
  api.publish.mockResolvedValueOnce({
    result: 'success',
    created_at: 1704067200,
    warning: '"Answer" ← "Producer"',
  })
  renderEditor()
  await user.click(await openPublisher(user))
  await waitFor(() => expect(warning).toHaveBeenCalledWith('"Answer" ← "Producer"'))
  expect(success).not.toHaveBeenCalled()
})

it('shows the plan upgrade hint when publishing exceeds the trigger node limit', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  api.publish.mockRejectedValueOnce(
    new ORPCError('trigger_node_limit_exceeded', {
      defined: true,
      status: 403,
      message: 'Backend text',
      data: {
        code: 'trigger_node_limit_exceeded',
        message: 'Backend text',
        status: 403,
        details: { count: 3, limit: 2 },
      },
    }),
  )
  renderEditor()
  const publish = await openPublisher(user)
  expect(publish).toBeEnabled()
  expect(screen.queryByText(/publishLimit\.startNodeDesc/)).not.toBeInTheDocument()

  await user.click(publish)

  expect(await screen.findByText(/publishLimit\.startNodeDesc/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /upgradeBtn\.encourageShort/ })).toBeInTheDocument()
  expect(error).not.toHaveBeenCalled()
})

it('reports other publish failures with the server message', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  api.publish.mockRejectedValueOnce(
    new ORPCError('BAD_REQUEST', { status: 400, message: 'Workflow is invalid' }),
  )
  renderEditor()
  await user.click(await openPublisher(user))

  await waitFor(() => expect(error).toHaveBeenCalledWith('Workflow is invalid'))
  expect(screen.queryByText(/publishLimit\.startNodeDesc/)).not.toBeInTheDocument()
})

it('shows outputs from both end nodes and identifies conflicting names in tool configuration', async () => {
  const user = userEvent.setup()
  const graph = validGraph()
  graph.nodes.push(
    createNode({
      id: 'fallback',
      position: { x: 600, y: 300 },
      data: {
        type: BlockEnum.End,
        title: 'Fallback',
        outputs: [
          { variable: 'answer', value_type: VarType.string, value_selector: ['code', 'answer'] },
        ],
      },
    }),
  )
  graph.edges.push(
    createEdge({
      source: 'code',
      target: 'fallback',
      sourceHandle: 'source',
      targetHandle: 'target',
      data: { sourceType: BlockEnum.Code, targetType: BlockEnum.End },
    }),
  )
  renderEditor({ graph })
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: /navigation.common.workflowAsTool/ }))
  const drawer = await screen.findByRole('dialog', { name: 'navigation.common.workflowAsTool' })
  expect(within(drawer).getByRole('row', { name: /answer.*Response/ })).toBeInTheDocument()
  expect(within(drawer).getByRole('row', { name: /answer.*Fallback/ })).toBeInTheDocument()
})

it('publishes the workflow with legacy image input as a tool and reports one success', async () => {
  const user = userEvent.setup()
  const success = vi.spyOn(toast, 'success')
  const { store } = renderEditor({ features: { file: { image: { enabled: true } } } })
  await openPublisher(user)
  await user.click(screen.getByRole('button', { name: /navigation.common.workflowAsTool/ }))
  const drawer = await screen.findByRole('dialog', { name: 'navigation.common.workflowAsTool' })
  expect(within(drawer).getByRole('row', { name: /__image files/ })).toBeInTheDocument()
  await user.type(
    within(drawer).getByRole('textbox', { name: 'tools.createTool.nameForToolCall' }),
    'workflow_tool',
  )
  await user.click(within(drawer).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(api.createTool).toHaveBeenCalledOnce())
  expect(api.publish).toHaveBeenCalledOnce()
  expect(api.createTool).toHaveBeenCalledWith({
    body: expect.objectContaining({
      name: 'workflow_tool',
      workflow_app_id: 'app-1',
      parameters: [{ name: '__image', description: '', form: 'llm' }],
    }),
  })
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'navigation.common.workflowAsTool' }),
    ).not.toBeInTheDocument(),
  )
  expect(store.getState().toolPublished).toBe(true)
  expect(success).toHaveBeenCalledExactlyOnceWith('common.api.actionSuccess')
  await user.click(trigger())
  expect(await screen.findByText('workflow.common.workflowAsToolReady')).toBeInTheDocument()
})

it('refreshes roster caches after publishing a workflow with a roster agent node', async () => {
  const user = userEvent.setup()
  const graph = validGraph()
  graph.nodes.push(
    createNode({
      id: 'agent-node',
      position: { x: 150, y: 200 },
      data: {
        ...agentDefault.defaultValue,
        type: BlockEnum.Agent,
        title: 'Agent step',
        agent_binding: { binding_type: 'roster_agent', agent_id: 'agent-1' },
      },
    }),
  )
  graph.edges.splice(
    0,
    1,
    createEdge({
      source: 'start',
      target: 'agent-node',
      sourceHandle: 'source',
      targetHandle: 'target',
      data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Agent },
    }),
    createEdge({
      source: 'agent-node',
      target: 'code',
      sourceHandle: 'source',
      targetHandle: 'target',
      data: { sourceType: BlockEnum.Agent, targetType: BlockEnum.Code },
    }),
  )
  const listKey = consoleQuery.agent.get.queryKey({ input: {} })
  const referencesKey = consoleQuery.agent.byAgentId.referencingWorkflows.get.queryKey({
    input: { params: { agent_id: 'agent-1' } },
  })
  const { queryClient } = renderEditor({
    graph,
    withInvalidation: true,
    seedQueries(client) {
      client.setQueryData(listKey, {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        has_more: false,
        publication_counts: { drafts: 0, published: 0 },
      })
      client.setQueryData(referencesKey, { data: [] })
      client.setQueryData(
        consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'agent-1' } } }),
        createAgentFixture(),
      )
    },
  })
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
  expect(queryClient.getQueryState(referencesKey)?.isInvalidated).toBe(false)
  await user.click(await openPublisher(user))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
  )
  // The publish refreshes the agent domain, which reads the workflow's agent references.
  await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true))
  expect(queryClient.getQueryState(referencesKey)?.isInvalidated).toBe(true)
})
