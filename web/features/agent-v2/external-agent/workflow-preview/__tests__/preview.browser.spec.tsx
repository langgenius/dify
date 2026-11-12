import type { ComponentType } from 'react'
import type { NodeProps } from 'reactflow'
import type { ExternalAgentWorkflowPreviewNodeData } from '../types'
import type { CommonNodeType, WorkflowDataUpdater } from '@/app/components/workflow/types'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import ReactFlow, { Handle, Position, ReactFlowProvider, useStore as useReactflow } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useShallow } from 'zustand/react/shallow'
import { FeaturesProvider } from '@/app/components/base/features'
import { useNodesSyncDraftByCanEdit } from '@/app/components/workflow-app/hooks/use-nodes-sync-draft'
import { useWorkflowDraftGraphForCanvas } from '@/app/components/workflow-app/hooks/use-workflow-draft-graph-for-canvas'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store/provider'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { NodeComponentMap } from '@/app/components/workflow/nodes/components'
import Panel from '@/app/components/workflow/nodes/panel'
import { createWorkflowStore, useWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createExternalRosterPreview } from '@/features/agent-v2/roster/external-roster-preview'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import workflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import workflowDebug from '@/i18n/locales/en-US/workflow-debug.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { consoleClient, consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
  createConsoleQueryWrapper,
  seedAppDetail,
  seedAppDslVersion,
} from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createExternalAgentWorkflowPreviewData } from '../preview'
import { isExternalAgentWorkflowPreviewData } from '../types'
import 'reactflow/dist/style.css'

vi.mock('react-i18next', async (importOriginal) => importOriginal())

const draftApi = vi.hoisted(() => ({
  save: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.post>(),
  read: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.get>(),
}))

// boundary: keep draft serialization and hydration real, replacing only backend storage.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.post': draftApi.save,
      'apps.byAppId.workflows.draft.get': draftApi.read,
    }),
  }
})

// The Agent catalog entry routes external preview data before mounting Dify API owners.
const AgentNode = NodeComponentMap[BlockEnum.Agent] as unknown as ComponentType<{
  id: string
  data: ExternalAgentWorkflowPreviewNodeData
}>

function CanvasNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      {isExternalAgentWorkflowPreviewData(data) ? (
        <AgentNode id={id} data={data} />
      ) : (
        <div>{data.title}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </>
  )
}

const nodeTypes = { custom: CanvasNode }

function SelectedPanel() {
  // Match the workflow panel's getNodes subscription, including immediate picker updates.
  const node = useReactflow(
    useShallow((state) => {
      const selected = state.getNodes().find((node) => node.data.selected)
      return selected && { id: selected.id, type: selected.type, data: selected.data }
    }),
  )
  return node ? <Panel type={node.type} id={node.id} data={node.data} /> : null
}

function DraftCanvas({ graph }: { graph: WorkflowDataUpdater }) {
  const draft = useNodesSyncDraftByCanEdit(true)
  const workflowStore = useWorkflowStore()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas('workflow')
  const hydrated = getWorkflowDraftGraphForCanvas(graph)
  return (
    <HooksStoreContextProvider {...draft}>
      <button type="button" onClick={() => workflowStore.getState().flushPendingSync()}>
        Save workflow draft
      </button>
      <WorkflowCanvas graph={hydrated} />
    </HooksStoreContextProvider>
  )
}

function WorkflowCanvas({ graph }: { graph: WorkflowDataUpdater }) {
  const { handleNodeClick } = useNodesInteractions()
  return (
    <div className="isolate flex gap-4" style={{ height: 960 }}>
      <section aria-label="Agent canvas" style={{ width: 480, height: 960 }}>
        <ReactFlow
          defaultNodes={initialNodes(graph.nodes, graph.edges)}
          defaultEdges={initialEdges(graph.edges, graph.nodes)}
          defaultViewport={graph.viewport}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
        />
      </section>
      <SelectedPanel />
    </div>
  )
}

async function setup(graph?: WorkflowDataUpdater, name = 'Contract Review Agent') {
  await page.viewport(1280, 1000)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common, workflowAgent, workflowDebug, workflow } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  onTestFinished(() => queryClient.clear())
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedAppDetail(
    queryClient,
    createAppDetailFixture({ id: 'external-preview-app', mode: 'workflow' }),
  )
  seedAppDslVersion(queryClient)
  const draftInput = { params: { app_id: 'external-preview-app' } }
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryKey({
      input: draftInput,
    }),
    { items: [] },
  )
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.systemVariables.get.queryKey({ input: draftInput }),
    { items: [] },
  )
  const store = createWorkflowStore({
    injectWorkflowStoreSliceFn: () => ({ isWorkflowDataLoaded: true }),
  })
  onTestFinished(() => store.getState().debouncedSyncWorkflowDraft.cancel?.())
  const agent = createExternalRosterPreview()[1]!
  const data: ExternalAgentWorkflowPreviewNodeData = {
    type: BlockEnum.Agent,
    title: 'Agent',
    desc: '',
    selected: true,
    ...createExternalAgentWorkflowPreviewData(agent),
  }
  const nodes = [
    createNode({
      id: 'input',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.Start,
        title: 'Input',
        variables: [
          {
            variable: 'contract_text',
            type: InputVarType.paragraph,
            label: 'Contract text',
            required: false,
          },
        ],
      },
    }),
    createNode({
      id: 'policy',
      position: { x: 0, y: 100 },
      data: {
        type: BlockEnum.Code,
        title: 'Policy',
        outputs: { result: { type: VarType.string } },
      },
    }),
    createNode({ id: 'external-agent', position: { x: 160, y: 50 }, selected: true, data }),
  ]
  const edges = [
    createEdge({ source: 'input', target: 'policy' }),
    createEdge({ source: 'policy', target: 'external-agent' }),
  ]
  const rendered = await render(
    <QueryProvider>
      <EditorResourceScope
        resource={{
          kind: 'app',
          appId: 'external-preview-app',
          mode: 'workflow',
          collaborationEnabled: false,
        }}
      >
        <WorkflowContext value={store}>
          <FeaturesProvider>
            <EventEmitterContextProvider>
              <I18nextProvider i18n={i18n}>
                <ReactFlowProvider>
                  <DraftCanvas
                    graph={graph ?? { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }}
                  />
                </ReactFlowProvider>
              </I18nextProvider>
            </EventEmitterContextProvider>
          </FeaturesProvider>
        </WorkflowContext>
      </EditorResourceScope>
    </QueryProvider>,
  )
  const panel = page.getByRole('region', { name, exact: true })
  await expect.element(panel).toBeVisible()
  return {
    panel,
    canvas: page.getByRole('region', { name: 'Agent canvas', exact: true }),
    unmount: rendered.unmount,
  }
}

async function closeAndReopen(
  panel: ReturnType<typeof page.getByRole>,
  name = 'Contract Review Agent',
) {
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel).not.toBeInTheDocument()
  await page
    .getByRole('region', { name: 'Agent canvas', exact: true })
    .getByText(name, { exact: true })
    .click()
  const reopened = page.getByRole('region', { name, exact: true })
  await expect.element(reopened).toBeVisible()
  return reopened
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  let saved = JSON.stringify(createWorkflowResponseFixture())
  draftApi.save.mockImplementation(async ({ body }) => {
    saved = JSON.stringify(createWorkflowResponseFixture({ graph: body.graph, hash: 'saved-hash' }))
    return { result: 'success', hash: 'saved-hash', updated_at: 2 }
  })
  draftApi.read.mockImplementation(async () => JSON.parse(saved))
})

it('shows the external badge and updates the canvas agent through the change picker without Dify APIs', async () => {
  const { panel, canvas } = await setup()
  await expect.element(panel.getByText('External', { exact: true })).toBeVisible()
  await expect.element(canvas.getByText('External', { exact: true })).toBeVisible()
  await expect
    .element(panel.getByRole('tab', { name: 'Settings', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(panel.getByRole('button', { name: /Run this step/i }))
    .toHaveAttribute('aria-disabled', 'true')
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /Document Review Agent/ }).click()
  const changedPanel = page.getByRole('region', { name: 'Document Review Agent', exact: true })
  await expect.element(changedPanel).toBeVisible()
  await expect
    .element(changedPanel.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toHaveTextContent('')
  await expect.element(canvas.getByText('Document Review Agent', { exact: true })).toBeVisible()
  await expect
    .element(canvas.getByText('Contract Review Agent', { exact: true }))
    .not.toBeInTheDocument()
  await closeAndReopen(changedPanel, 'Document Review Agent')
})

it('restores the external agent and its settings from a serialized draft after remounting the graph', async () => {
  const { panel, unmount } = await setup()
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /Document Review Agent/ }).click()
  const changed = page.getByRole('region', { name: 'Document Review Agent', exact: true })
  await expect.element(changed).toBeVisible()
  await changed
    .getByRole('textbox', { name: 'Agent task', exact: true })
    .fill('Review the saved contract.')
  await changed.getByRole('textbox', { name: 'Wait limit', exact: true }).fill('25')
  await userEvent.tab()
  await changed.getByRole('combobox', { name: 'On timeout', exact: true }).click()
  await page.getByRole('option', { name: 'Cancel and retry', exact: true }).click()
  await changed.getByRole('textbox', { name: 'Max retries', exact: true }).fill('3')
  await userEvent.tab()
  await changed.getByRole('textbox', { name: 'Retry interval', exact: true }).fill('45')
  await userEvent.tab()
  await changed.getByRole('button', { name: 'New output', exact: true }).click()
  await changed.getByRole('textbox', { name: 'Field name', exact: true }).fill('review_notes')
  await changed.getByRole('button', { name: 'Confirm', exact: true }).click()
  await changed.getByRole('button', { name: 'Fail Branch', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^None/ }).click()
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  await expect.poll(() => draftApi.save.mock.calls.length).toBeGreaterThan(0)
  const saved = await consoleClient.apps.byAppId.workflows.draft.get({
    params: { app_id: 'external-preview-app' },
  })
  expect(saved.graph).toMatchObject({
    nodes: expect.arrayContaining([
      expect.objectContaining({
        id: 'external-agent',
        data: expect.objectContaining({
          agent_node_kind: 'external_agent',
          external_agent: expect.objectContaining({ name: 'Document Review Agent' }),
          agent_task: 'Review the saved contract.',
          error_strategy: 'none',
          agent_declared_outputs: expect.arrayContaining([
            expect.objectContaining({ name: 'review_notes' }),
          ]),
          external_agent_wait_limit: {
            enabled: true,
            minutes: 25,
            onTimeout: 'cancel-and-retry',
            maxRetries: 3,
            retryIntervalSeconds: 45,
          },
        }),
      }),
    ]),
    edges: expect.arrayContaining([
      expect.objectContaining({ source: 'policy', target: 'external-agent' }),
    ]),
  })
  await unmount()
  await expect.element(changed).not.toBeInTheDocument()
  const { panel: restored, canvas } = await setup(
    saved.graph as WorkflowDataUpdater,
    'Document Review Agent',
  )
  await expect.element(canvas.getByText('Document Review Agent', { exact: true })).toBeVisible()
  await expect
    .element(restored.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toHaveTextContent('Review the saved contract.')
  await expect
    .element(restored.getByRole('button', { name: 'Delete review_notes', exact: true }))
    .toBeInTheDocument()
  await expect
    .element(restored.getByRole('textbox', { name: 'Wait limit', exact: true }))
    .toHaveValue('25')
  await expect
    .element(restored.getByRole('combobox', { name: 'On timeout', exact: true }))
    .toHaveTextContent('Cancel and retry')
  await expect
    .element(restored.getByRole('textbox', { name: 'Max retries', exact: true }))
    .toHaveValue('3')
  await expect
    .element(restored.getByRole('textbox', { name: 'Retry interval', exact: true }))
    .toHaveValue('45')
  await expect.element(restored.getByRole('button', { name: 'None', exact: true })).toBeVisible()
})

it('starts with an empty task and retains edits when closing and reopening the node', async () => {
  const { panel } = await setup()
  const task = panel.getByRole('textbox', { name: 'Agent task', exact: true })
  await expect.element(task).toHaveTextContent('')
  await task.fill('Review the renewal terms and highlight unusual liability clauses. ')
  await userEvent.keyboard('/')
  await page
    .getByRole('listbox', { name: 'Typeahead menu', exact: true })
    .getByText('contract_text', { exact: true })
    .click()
  await expect.element(task.getByText('contract_text', { exact: true })).toBeVisible()
  await userEvent.tab()
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toMatchTextContent('Review the renewal terms and highlight unusual liability clauses.')
  await expect
    .element(
      reopened
        .getByRole('textbox', { name: 'Agent task', exact: true })
        .getByText('contract_text', { exact: true }),
    )
    .toBeVisible()
})

it('retains the wait limit and error strategy through panel reopening', async () => {
  const { panel } = await setup()
  const enabled = panel.getByRole('switch', { name: 'External agent wait limit', exact: true })
  const minutes = panel.getByRole('textbox', { name: 'Wait limit', exact: true })
  await expect.element(enabled).toBeChecked()
  await expect.element(minutes).toHaveValue('10')
  await minutes.fill('25')
  await userEvent.tab()
  await expect
    .element(panel.getByRole('slider', { name: 'Wait limit', exact: true }))
    .toHaveAttribute('aria-valuenow', '25')
  await enabled.click()
  await expect.element(enabled).not.toBeChecked()
  await enabled.click()
  await expect.element(minutes).toHaveValue('25')
  const errorHandling = panel.getByRole('button', { name: 'Fail Branch', exact: true })
  await expect.element(errorHandling).toBeVisible()
  await errorHandling.click()
  await page.getByRole('menuitemradio', { name: /^None/ }).click()
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('textbox', { name: 'Wait limit', exact: true }))
    .toHaveValue('25')
  await expect.element(reopened.getByRole('button', { name: 'None', exact: true })).toBeVisible()
  await expect
    .element(reopened.getByRole('combobox', { name: 'On timeout', exact: true }))
    .toMatchTextContent('End waiting')
})

it('shows each timeout action and retains the cancellation choice through reopening', async () => {
  const { panel } = await setup()
  const timeout = panel.getByRole('combobox', { name: 'On timeout', exact: true })
  await expect.element(timeout).toHaveTextContent('End waiting')
  await expect
    .element(panel.getByRole('textbox', { name: 'Max retries', exact: true }))
    .not.toBeInTheDocument()
  await timeout.click()
  for (const name of ['End waiting', 'Request cancellation', 'Cancel and retry']) {
    await expect.element(page.getByRole('option', { name, exact: true })).toBeVisible()
  }
  await page.getByRole('option', { name: 'Request cancellation', exact: true }).click()
  const help =
    'Request cancellation and wait for confirmation. If the task finishes first, use its result.'
  await expect.element(timeout).toHaveAccessibleDescription(help)
  await expect.element(panel.getByText(help, { exact: true })).toBeVisible()
  await expect
    .element(panel.getByRole('textbox', { name: 'Max retries', exact: true }))
    .not.toBeInTheDocument()
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('combobox', { name: 'On timeout', exact: true }))
    .toHaveTextContent('Request cancellation')
  await expect.element(reopened.getByText(help, { exact: true })).toBeVisible()
})

it('retains retry parameters when changing timeout modes, toggling the wait limit, and reopening', async () => {
  const { panel } = await setup()
  const timeout = panel.getByRole('combobox', { name: 'On timeout', exact: true })
  await timeout.click()
  await page.getByRole('option', { name: 'Cancel and retry', exact: true }).click()
  await expect
    .element(
      panel.getByText(
        'Submit a new task only after cancellation is confirmed. Actions and charges may be repeated.',
        { exact: true },
      ),
    )
    .toBeVisible()
  const retries = panel.getByRole('textbox', { name: 'Max retries', exact: true })
  const interval = panel.getByRole('textbox', { name: 'Retry interval', exact: true })
  await expect.element(retries).toHaveValue('2')
  await expect.element(interval).toHaveValue('30')
  await retries.fill('3')
  await userEvent.tab()
  await interval.fill('45')
  await userEvent.tab()
  await expect
    .element(panel.getByRole('slider', { name: 'Max retries', exact: true }))
    .toHaveAttribute('aria-valuenow', '3')
  await expect
    .element(panel.getByRole('slider', { name: 'Retry interval', exact: true }))
    .toHaveAttribute('aria-valuenow', '45')

  await timeout.click()
  await page.getByRole('option', { name: 'End waiting', exact: true }).click()
  await expect.element(retries).not.toBeInTheDocument()
  await expect.element(interval).not.toBeInTheDocument()
  await timeout.click()
  await page.getByRole('option', { name: 'Cancel and retry', exact: true }).click()
  await expect.element(retries).toHaveValue('3')
  await expect.element(interval).toHaveValue('45')

  const enabled = panel.getByRole('switch', { name: 'External agent wait limit', exact: true })
  await enabled.click()
  await expect.element(timeout).not.toBeInTheDocument()
  await enabled.click()
  await expect.element(timeout).toHaveTextContent('Cancel and retry')
  await expect.element(retries).toHaveValue('3')
  await expect.element(interval).toHaveValue('45')
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('combobox', { name: 'On timeout', exact: true }))
    .toHaveTextContent('Cancel and retry')
  await expect
    .element(reopened.getByRole('textbox', { name: 'Max retries', exact: true }))
    .toHaveValue('3')
  await expect
    .element(reopened.getByRole('textbox', { name: 'Retry interval', exact: true }))
    .toHaveValue('45')
})

it('creates an output token from the task editor and retains its output definition', async () => {
  const { panel } = await setup()
  await panel.getByRole('textbox', { name: 'Agent task', exact: true }).fill('Return ')
  await userEvent.keyboard('/')
  await page
    .getByRole('listbox', { name: 'Typeahead menu', exact: true })
    .getByRole('button', { name: 'New output', exact: true })
    .click()
  const name = page.getByRole('textbox', { name: 'Field name', exact: true })
  await expect.element(name).toHaveFocus()
  await name.fill('review_notes')
  await userEvent.keyboard('{Enter}')
  await expect.element(name).not.toBeInTheDocument()
  await expect
    .element(panel.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toMatchTextContent(/review_notes/)
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toMatchTextContent(/review_notes/)
  await expect
    .element(reopened.getByRole('button', { name: 'Delete review_notes', exact: true }))
    .toBeInTheDocument()
})

it('allows the default text output to be edited and deleted while retaining a newly added output', async () => {
  const { panel } = await setup()
  await expect.element(panel.getByText('Text returned by the agent', { exact: true })).toBeVisible()
  await panel.getByText('text', { exact: true }).last().hover()
  await panel.getByRole('button', { name: 'Edit text', exact: true }).click()
  await panel
    .getByRole('form', { name: 'Output variable editor', exact: true })
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Contract review result')
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.element(panel.getByText('Contract review result', { exact: true })).toBeVisible()
  await panel.getByText('text', { exact: true }).last().hover()
  await panel.getByRole('button', { name: 'Edit text', exact: true }).click()
  const name = panel.getByRole('textbox', { name: 'Field name', exact: true })
  await name.fill('summary')
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.element(panel.getByText('summary', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'New output', exact: true }).click()
  await name.fill('review_notes')
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  await panel.getByText('summary', { exact: true }).hover()
  await panel.getByRole('button', { name: 'Delete summary', exact: true }).click()
  await expect.element(panel.getByText('summary', { exact: true })).not.toBeInTheDocument()
  const reopened = await closeAndReopen(panel)
  await expect.element(reopened.getByText('review_notes', { exact: true })).toBeVisible()
  await expect.element(reopened.getByText('text', { exact: true })).not.toBeInTheDocument()
})

it('shows the empty Last Run tab without requesting an execution record', async () => {
  const { panel } = await setup()
  await panel.getByRole('tab', { name: 'Last Run', exact: true }).click()
  await expect
    .element(panel.getByText('The results of the last run will be displayed here', { exact: true }))
    .toBeVisible()
  await panel.getByRole('tab', { name: 'Settings', exact: true }).click()
  await expect
    .element(panel.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toBeVisible()
})
