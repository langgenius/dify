import type { QueryClient } from '@tanstack/react-query'
import type { AvailableNodesMetaData } from '../hooks-store'
import type { Node } from '../types'
import type { WorkflowAppMode } from '@/app/components/apps/app-type'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { deleteDB } from 'idb'
import { LoroDoc } from 'loro-crdt'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useMemo } from 'react'
import { useReactFlow } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { TEST_APP_ID } from '@/test/console/ids'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import {
  createTriggerEventResponseFixture,
  createTriggerProviderResponseFixture,
  seedTriggerPlugins,
} from '@/test/console/trigger-plugins'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { WorkflowWithInnerContext } from '..'
import { createDraftServer } from '../collaboration/core/__tests__/test-loro-draft-server'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { changeDraftEntities } from '../collaboration/core/loro-draft-document'
import { webSocketClient } from '../collaboration/core/websocket-manager'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import DatasetsDetailProvider from '../datasets-detail-store/provider'
import { fullWorkflowAccessControl } from '../hooks-store/store'
import { useWorkflowNodeCatalog } from '../node-catalog'
import agentDefault from '../nodes/agent-v2/default'
import toolDefault from '../nodes/tool/default'
import triggerDefault from '../nodes/trigger-plugin/default'
import scheduleDefault from '../nodes/trigger-schedule/default'
import webhookDefault from '../nodes/trigger-webhook/default'
import Panel from '../panel'
import { BlockEnum } from '../types'
import { createNode, createStartNode } from './fixtures'
import { renderWorkflowBrowserComponent } from './workflow-browser-test-env'

const binding = {
  binding_type: 'inline_agent' as const,
  agent_id: '00000000-0000-4000-8000-000000000011',
  current_snapshot_id: '00000000-0000-4000-8000-000000000012',
}
const composer = zWorkflowAgentComposerResponse.parse({
  variant: 'workflow',
  agent_soul: { schema_version: 1, prompt: { system_prompt: '' } },
  node_job: {},
  save_options: [],
  soul_lock: { locked: false },
  binding: { ...binding, id: 'binding-1', node_id: 'candidate', workflow_id: 'workflow-1' },
})
const codeConfig = { code: 'def main(): return {}', outputs: {}, variables: [] }
const pluginParameter = {
  name: 'format',
  type: 'string',
  label: { en_US: 'Format' },
  default: 'json',
} as const
const defaultParameter = { format: { value: 'json' } }
const urls = {
  webhook_url: 'https://example.com/hook',
  webhook_debug_url: 'https://example.com/debug',
}

setupFakeApi({
  console: {
    knowledgeFs: { spaces: { get: () => ({ data: [], page: 1, limit: 50, has_more: false }) } },
    workspaces: {
      current: {
        toolProvider: {
          builtin: {
            byProvider: {
              credential: {
                info: {
                  get: () => ({ credentials: [], supported_credential_types: [] }),
                },
              },
            },
          },
        },
        triggerProvider: { byProvider: { subscriptions: { list: { get: () => [] } } } },
        modelProviders: {
          byProvider: { models: { parameterRules: { get: () => ({ data: [] }) } } },
        },
      },
    },
    apps: {
      byAppId: {
        workflow: {
          comments: { get: () => ({ data: [] }), mentionUsers: { get: () => ({ users: [] }) } },
        },
        workflows: {
          defaultWorkflowBlockConfigs: { byBlockType: { get: () => ({ config: codeConfig }) } },
          draft: {
            variables: { get: () => ({ items: [], total: 0 }) },
            nodes: { byNodeId: { agentComposer: { put: () => composer, get: () => composer } } },
          },
          triggers: {
            webhook: {
              get: () => ({ id: 'hook', node_id: 'candidate', webhook_id: 'hook', ...urls }),
            },
          },
        },
      },
    },
  },
})

const start = createStartNode({
  id: 'start',
  ariaLabel: 'Start',
  position: { x: 100, y: 100 },
  data: { variables: [] },
})

function Editor({ nodes }: { nodes: Node[] }) {
  const flow = useReactFlow()
  const flowStore = useMemo(() => ({ getState: () => flow }), [flow])
  useCollaboration(TEST_APP_ID, true, flowStore)
  const catalog = useWorkflowNodeCatalog()
  const nodesMap = catalog.nodesMap as NonNullable<AvailableNodesMetaData['nodesMap']>
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <WorkflowWithInnerContext
        nodes={nodes}
        edges={[]}
        sidePanel={<Panel />}
        hooksStore={{
          accessControl: fullWorkflowAccessControl,
          doSyncWorkflowDraft: async (_force, callbacks) => {
            if (!callbacks?.onSuccess) return
            await collaborationManager.syncLoroDraft(TEST_APP_ID)
            callbacks.onSuccess()
          },
          availableNodesMetaData: {
            nodesMap,
            nodes: catalog.nodes.map((n) => nodesMap[n.metaData.type]),
          },
        }}
      />
    </div>
  )
}

afterEach(async () => {
  collaborationManager.disconnect()
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

async function openEditor(mode: WorkflowAppMode = 'workflow', nodes: Node[] = [start]) {
  const server = createDraftServer(() => {
    const doc = new LoroDoc()
    doc.getMap('graph').set('schema_version', 2)
    changeDraftEntities(doc, 'nodes', [], nodes)
    changeDraftEntities(doc, 'edges', [], [])
    return doc
  })
  const transport = server.transport()
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
  const { NavigationProvider } = createTestNavigation({ url: `/app/${TEST_APP_ID}/workflow` })
  const { queryClient } = createConsoleQueryWrapper({
    appDslVersion: '0.6.0',
    features: { enable_knowledge_fs: true },
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  await page.viewport(1440, 850)
  const screen = await renderWorkflowBrowserComponent(
    <NavigationProvider>
      <NuqsTestingAdapter>
        <EventEmitterContextProvider>
          <DatasetsDetailProvider nodes={nodes}>
            <Editor nodes={nodes} />
          </DatasetsDetailProvider>
        </EventEmitterContextProvider>
      </NuqsTestingAdapter>
    </NavigationProvider>,
    {
      queryClient,
      resource: { kind: 'app', appId: TEST_APP_ID, mode, collaborationEnabled: true },
      initialStoreState: {
        loroDraft: server.identity,
        nodesDefaultConfigs: {
          [BlockEnum.Code]: codeConfig,
          [BlockEnum.TemplateTransform]: { template: '{{ value }}', variables: [] },
          [BlockEnum.HumanInput]: {
            version: '2',
            message_template: { subject: 'Review', body: '{{#url#}}' },
          },
        },
      },
    },
  )
  onTestFinished(() => screen.store.getState().debouncedSyncWorkflowDraft.cancel?.())
  await vi.waitFor(() =>
    expect(transport.emit.mock.calls.some(([event]) => event === 'user_connect')).toBe(true),
  )
  transport.acknowledge('user_connect', { msg: 'connected' })
  await vi.waitFor(() => expect(collaborationManager.canPersistLocalGraph()).toBe(true))

  const undo = screen.getByRole('button', { name: 'workflow.common.undo', exact: true })
  const redo = screen.getByRole('button', { name: 'workflow.common.redo', exact: true })
  const addConnectedNode = async (type: BlockEnum) => {
    const add = screen
      .getByRole('button', { name: 'Start', exact: true })
      .getByRole('button', { name: 'workflow.common.addBlock' })
    await expect.element(add).toBeInTheDocument()
    add.element().focus()
    await userEvent.keyboard('{Enter}')
    await page
      .getByRole('button', { name: new RegExp(`^workflow\\.blocks\\.${type}(?:\\s|$)`) })
      .click()
  }
  const title = (type: BlockEnum) =>
    screen
      .getByRole('region', { name: 'app.types.workflow' })
      .getByText(`workflow.blocks.${type}`, { exact: true })
  return { screen, queryClient, addConnectedNode, undo, redo, title }
}

const findNode = (type: BlockEnum) =>
  collaborationManager.getNodes().find((node) => node.data.type === type)

function loadWorkspaceModels(queryClient: QueryClient) {
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({ model_properties: { mode: 'chat' } }),
        createCatalogModelFixture({
          model: 'manual-model',
          label: { en_US: 'Manual model' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture() },
  )
}

it.each([BlockEnum.ParameterExtractor, BlockEnum.LLM, BlockEnum.QuestionClassifier])(
  'undoes adding a connected %s after its default model loads and preserves manual model edits',
  async (type) => {
    const { screen, queryClient, addConnectedNode, undo, redo, title } = await openEditor()
    await addConnectedNode(type)
    await expect.poll(() => findNode(type)).toMatchObject({ data: { model: { provider: '' } } })
    expect(collaborationManager.getEdges()).toHaveLength(1)
    loadWorkspaceModels(queryClient)
    await expect.poll(() => findNode(type)).toMatchObject({ data: { model: { name: 'gpt-4' } } })
    await collaborationManager.syncLoroDraft(TEST_APP_ID)
    const nodeTitle = title(type)
    expect(collaborationManager.getDraftHistory().undo).toEqual(['NodeAdd'])
    await undo.click()
    await expect.element(nodeTitle).not.toBeInTheDocument()
    expect(collaborationManager.getNodes().map((node) => node.id)).toEqual(['start'])
    expect(collaborationManager.getEdges()).toEqual([])
    await redo.click()
    await expect.poll(() => findNode(type)).toMatchObject({ data: { model: { name: 'gpt-4' } } })
    expect(collaborationManager.getEdges()).toMatchObject([
      { source: 'start', target: findNode(type)?.id },
    ])
    await nodeTitle.click()
    await screen.getByRole('tabpanel').getByRole('button', { name: /GPT-4/i }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Manual model/i })
      .click()
    await expect
      .poll(() => findNode(type))
      .toMatchObject({ data: { model: { name: 'manual-model' } } })
    await undo.click()
    await expect.poll(() => findNode(type)).toMatchObject({ data: { model: { name: 'gpt-4' } } })
  },
)

it('opens an existing webhook and fills its URLs without adding undo history', async () => {
  const webhook = createNode({
    id: 'candidate',
    data: {
      ...webhookDefault.defaultValue,
      type: BlockEnum.TriggerWebhook,
      title: 'Webhook setup',
    },
  })
  const { screen } = await openEditor('workflow', [start, webhook])
  await screen
    .getByRole('region', { name: 'app.types.workflow' })
    .getByText('Webhook setup', { exact: true })
    .click()
  await expect.poll(() => findNode(BlockEnum.TriggerWebhook)?.data).toMatchObject(urls)
  expect(collaborationManager.getDraftHistory()).toEqual({ undo: [], redo: [] })
})

it.each([
  [BlockEnum.TriggerWebhook, webhookDefault.defaultValue, urls],
  [BlockEnum.Agent, agentDefault.defaultValue, { agent_binding: binding }],
  [BlockEnum.TriggerSchedule, scheduleDefault.defaultValue, { timezone: 'UTC' }],
  [
    BlockEnum.Tool,
    {
      ...toolDefault.defaultValue,
      provider_id: 'provider-1',
      provider_name: 'provider',
      provider_type: 'builtin',
      tool_name: 'format',
      tool_label: 'Format',
    },
    { tool_parameters: defaultParameter },
  ],
  [
    BlockEnum.TriggerPlugin,
    {
      ...triggerDefault.defaultValue,
      provider_id: 'trigger-provider',
      provider_name: 'trigger-provider',
      event_name: 'trigger_event',
      output_schema: {},
    },
    { event_parameters: defaultParameter },
  ],
] as const)(
  'undoes placing a %s after its automatic configuration is saved',
  async (type, defaults, expected) => {
    const { screen, queryClient, undo, redo } = await openEditor()
    screen.store.getState().setCandidateNode(
      createNode({
        id: 'candidate',
        data: {
          ...defaults,
          type,
          title: 'Candidate',
          _isCandidate: true,
          selected: type !== BlockEnum.TriggerWebhook,
        },
      }),
    )
    await expect.element(page.getByText('Candidate', { exact: true })).toBeInTheDocument()
    await userEvent.pointer({ coords: { x: 540, y: 400 }, keys: '[MouseLeft]' })
    if (type === BlockEnum.Tool) {
      seedToolProviders(queryClient, {
        builtInTools: [
          createToolProviderFixture({
            tools: [
              {
                name: 'format',
                author: 'Dify',
                label: { en_US: 'Format' },
                description: { en_US: '' },
                parameters: [{ ...pluginParameter, form: 'llm' }],
              },
            ],
          }),
        ],
      })
    }
    if (type === BlockEnum.TriggerPlugin) {
      seedTriggerPlugins(queryClient, [
        createTriggerProviderResponseFixture({
          events: [createTriggerEventResponseFixture({ parameters: [pluginParameter] })],
        }),
      ])
    }
    await expect.poll(() => findNode(type)?.data).toMatchObject(expected)
    await collaborationManager.syncLoroDraft(TEST_APP_ID)
    expect(collaborationManager.getDraftHistory().undo).toEqual(['NodeAdd'])
    await undo.click()
    await expect
      .poll(() => collaborationManager.getNodes().map((node) => node.id))
      .toEqual(['start'])
    await redo.click()
    await expect.poll(() => findNode(type)?.data).toMatchObject(expected)
  },
)

it.each([
  BlockEnum.KnowledgeRetrieval,
  BlockEnum.KnowledgeRetrievalV2,
  BlockEnum.Answer,
  BlockEnum.Assigner,
  BlockEnum.DocExtractor,
  BlockEnum.HttpRequest,
  BlockEnum.TemplateTransform,
  BlockEnum.Iteration,
  BlockEnum.Loop,
  BlockEnum.IfElse,
  BlockEnum.End,
  BlockEnum.ListFilter,
  BlockEnum.VariableAggregator,
  BlockEnum.HumanInput,
  BlockEnum.Code,
])('undoes and redoes adding a connected %s with its default configuration', async (type) => {
  const { queryClient, addConnectedNode, undo, redo } = await openEditor(
    type === BlockEnum.Answer ||
      type === BlockEnum.Assigner ||
      type === BlockEnum.KnowledgeRetrieval
      ? 'advanced-chat'
      : 'workflow',
  )
  loadWorkspaceModels(queryClient)
  await addConnectedNode(type)
  await expect.poll(() => findNode(type)).toBeDefined()
  if (type === BlockEnum.Code)
    await expect.poll(() => findNode(type)?.data).toMatchObject({ code: codeConfig.code })
  if (type === BlockEnum.TemplateTransform)
    await expect.poll(() => findNode(type)?.data).toMatchObject({ template: '{{ value }}' })
  if (type === BlockEnum.KnowledgeRetrieval)
    await expect
      .poll(() => findNode(type)?.data)
      .toMatchObject({ query_variable_selector: ['start', 'sys.query'] })
  await collaborationManager.syncLoroDraft(TEST_APP_ID)
  const added = collaborationManager.getNodes()
  expect(collaborationManager.getDraftHistory().undo).toEqual(['NodeAdd'])
  await undo.click()
  await expect.poll(() => collaborationManager.getNodes().map((node) => node.id)).toEqual(['start'])
  expect(collaborationManager.getEdges()).toEqual([])
  await redo.click()
  await expect.poll(() => collaborationManager.getNodes()).toEqual(added)
  expect(collaborationManager.getEdges()).toMatchObject([
    { source: 'start', target: findNode(type)?.id },
  ])
})
