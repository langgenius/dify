import type {
  WorkflowAgentComposerResponse,
  WorkflowPublishResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { Features } from '@/app/components/base/features/types'
import type { InjectWorkflowStoreSliceFn, Shape } from '@/app/components/workflow/store'
import type { Edge, Node } from '@/app/components/workflow/types'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
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
  createTriggerNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import agentDefault from '@/app/components/workflow/nodes/agent-v2/default'
import codeDefault from '@/app/components/workflow/nodes/code/default'
import scheduleDefault from '@/app/components/workflow/nodes/trigger-schedule/default'
import webhookDefault from '@/app/components/workflow/nodes/trigger-webhook/default'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
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
    vi.fn<
      (
        url: string,
        options: { body: { marked_name: string; marked_comment: string } },
      ) => Promise<WorkflowPublishResponse>
    >(),
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
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post: api.publish,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
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
  edition = 'CLOUD',
  plan = 'sandbox',
  features = {},
  initialStoreState = {},
  permissions = Object.values(AppACLPermission),
  seedQueries,
}: {
  mode?: 'workflow' | 'advanced-chat'
  graph?: { nodes: Node[]; edges: Edge[] }
  edition?: DeploymentEdition
  plan?: CloudPlan
  features?: Features
  initialStoreState?: Partial<Shape>
  seedQueries?: (queryClient: QueryClient) => void
  permissions?: NonNullable<ReturnType<typeof createAppDetailFixture>['permission_keys']>
} = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: {
      deployment_edition: edition,
      enable_collaboration_mode: false,
      enable_marketplace: false,
      webapp_auth: { enabled: false },
    },
    features: { billing: { subscription: { plan } } },
    workspacePermissionKeys: ['tool.manage'],
  })
  const app = createAppDetailFixture({
    id: 'app-1',
    name: 'Workflow app',
    mode,
    permission_keys: permissions,
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
  expect(api.publish).toHaveBeenCalledExactlyOnceWith('/apps/app-1/workflows/publish', {
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

it.each([
  { edition: 'CLOUD', plan: 'sandbox', restricted: true },
  { edition: 'CLOUD', plan: 'professional', restricted: false },
  { edition: 'COMMUNITY', plan: 'sandbox', restricted: false },
  { edition: 'ENTERPRISE', plan: 'sandbox', restricted: false },
] as const)(
  'enforces the entry limit for $edition / $plan through the real publish button',
  async ({ edition, plan, restricted }) => {
    const user = userEvent.setup()
    const graph = validGraph()
    graph.nodes.push(
      createTriggerNode(BlockEnum.TriggerWebhook, {
        id: 'webhook',
        data: { ...webhookDefault.defaultValue },
      }),
      createTriggerNode(BlockEnum.TriggerSchedule, {
        id: 'schedule',
        data: { ...scheduleDefault.defaultValue },
      }),
    )
    renderEditor({ graph, edition, plan })
    const publish = await openPublisher(user)
    if (restricted) expect(publish).toBeDisabled()
    else expect(publish).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: /navigation.common.workflowAsTool/ }),
    ).not.toBeInTheDocument()
  },
)

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

it.each(['roster_agent', 'inline_agent'] as const)(
  'refreshes roster caches only when the published workflow references a roster agent: %s',
  async (bindingType) => {
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
          agent_binding:
            bindingType === 'roster_agent'
              ? { binding_type: bindingType, agent_id: 'agent-1' }
              : {
                  binding_type: bindingType,
                  agent_id: 'agent-1',
                  current_snapshot_id: 'snapshot-1',
                },
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
        if (bindingType === 'inline_agent') {
          client.setQueryData(
            consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
              input: { params: { app_id: 'app-1', node_id: 'agent-node' } },
            }),
            zWorkflowAgentComposerResponse.parse({
              variant: 'workflow',
              agent_soul: {
                schema_version: 1,
                prompt: { system_prompt: 'Follow the request' },
                model: {
                  model_provider: 'langgenius/openai/openai',
                  model: 'gpt-4o-mini',
                  plugin_id: 'langgenius/openai',
                },
              },
              node_job: {},
              save_options: [],
              soul_lock: { locked: false },
              agent: {
                id: 'agent-1',
                name: 'Inline agent',
                description: '',
                scope: 'workflow_only',
                status: 'active',
              },
              binding: {
                binding_type: 'inline_agent',
                agent_id: 'agent-1',
                current_snapshot_id: 'snapshot-1',
                id: 'binding-1',
                node_id: 'agent-node',
                workflow_id: 'workflow-1',
              },
            } satisfies WorkflowAgentComposerResponse),
          )
        }
      },
    })
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(referencesKey)?.isInvalidated).toBe(false)
    await user.click(await openPublisher(user))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
    )
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(bindingType === 'roster_agent')
    expect(queryClient.getQueryState(referencesKey)?.isInvalidated).toBe(
      bindingType === 'roster_agent',
    )
  },
)
