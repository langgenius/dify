import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { InputVar, WorkflowDataUpdater } from '@/app/components/workflow/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { consoleClient } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  createExternalAgentWorkflowGraph,
  createSerializedWorkflowDraftStorage,
  renderExternalAgentWorkflow,
} from './preview-browser-fixture'
import { workflowExternalAgents } from './workflow-api-fixtures'
import 'reactflow/dist/style.css'

// boundary: use the fixture's real I18nextProvider resources instead of the global translator double.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const draftApi = vi.hoisted(() => ({
  save: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.post>(),
  read: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.get>(),
  rebind:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.externalAgentBindings.byNodeId.rebind.post
    >(),
}))

// boundary: replace backend storage while retaining real variable lookup, editing, and draft serialization.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const { createWorkflowExternalResponses } = await import('./workflow-api-fixtures')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      ...createWorkflowExternalResponses(),
      'apps.byAppId.workflows.draft.externalAgentBindings.byNodeId.rebind.post': draftApi.rebind,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.post': draftApi.save,
      'apps.byAppId.workflows.draft.get': draftApi.read,
      'apps.byAppId.workflows.draft.externalAgentBindings.byNodeId.rebind.post': draftApi.rebind,
    }),
  }
})

function createTaskVariableGraph(documentAgent = false) {
  const agent = workflowExternalAgents[1]!
  const graph = createExternalAgentWorkflowGraph({
    nodeData: documentAgent
      ? {
          agent_binding: {
            binding_type: 'roster_agent',
            agent_id: agent.id,
            binding_epoch: 'document-epoch',
          },
          title: agent.name,
        }
      : {},
  })
  const variables: InputVar[] = [
    {
      variable: 'contract_text',
      label: 'Contract text',
      type: InputVarType.paragraph,
      required: false,
    },
    {
      variable: 'document_file',
      label: 'Document file',
      type: InputVarType.singleFile,
      required: false,
    },
    {
      variable: 'attached_files',
      label: 'Attached files',
      type: InputVarType.multiFiles,
      required: false,
    },
    {
      variable: 'metadata',
      label: 'Metadata',
      type: InputVarType.jsonObject,
      required: false,
      json_schema: {
        type: 'object',
        properties: { note: { type: 'string' }, count: { type: 'number' } },
        required: [],
        additionalProperties: false,
      },
    },
  ]
  const outputs: CodeNodeType['outputs'] = {
    result: { type: VarType.string, children: null },
    risk_score: { type: VarType.number, children: null },
    approved: { type: VarType.boolean, children: null },
    empty_object: { type: VarType.object, children: null },
  }
  graph.nodes = graph.nodes.map((node) => {
    if (node.id === 'input') return createNode({ ...node, data: { ...node.data, variables } })
    if (node.id === 'policy') return createNode({ ...node, data: { ...node.data, outputs } })
    return node
  })
  return graph
}

async function setup({
  graph = createTaskVariableGraph(),
  name = 'Contract Review Agent',
}: {
  graph?: WorkflowDataUpdater
  name?: string
} = {}) {
  const rendered = await renderExternalAgentWorkflow({ graph, name })
  onTestFinished(() => {
    rendered.workflowStore.getState().debouncedSyncWorkflowDraft.cancel?.()
    rendered.queryClient.clear()
  })
  await expect.element(rendered.panel).toBeVisible()
  return rendered
}

const readDraft = () =>
  consoleClient.apps.byAppId.workflows.draft.get({ params: { app_id: 'external-preview-app' } })

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  const storage = createSerializedWorkflowDraftStorage()
  draftApi.save.mockImplementation(storage.save)
  draftApi.read.mockImplementation(storage.read)
  draftApi.rebind.mockImplementation(storage.rebind)
})

it('uses real Card and deployment modes for files while guarding unsupported object selection by mouse and keyboard', async () => {
  const { panel } = await setup()
  const task = panel.getByRole('textbox', { name: 'Agent task', exact: true })
  await task.fill('Review ')
  await userEvent.keyboard('/')
  const menu = page.getByRole('listbox', { name: 'Typeahead menu', exact: true })
  await expect.element(menu.getByText('contract_text', { exact: true })).toBeVisible()
  await expect.element(menu.getByText('result', { exact: true })).toBeVisible()
  await expect.element(menu.getByText('attached_files', { exact: true })).toBeVisible()
  await expect.element(menu.getByText('document_file', { exact: true })).toBeVisible()
  for (const name of ['risk_score', 'approved', 'empty_object']) {
    await expect.element(menu.getByText(name, { exact: true })).not.toBeInTheDocument()
  }
  await userEvent.keyboard('metadata')
  await expect.element(menu.getByText('metadata', { exact: true })).toBeVisible()
  await expect.element(menu.getByText('contract_text', { exact: true })).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  await expect.element(task).toHaveTextContent('Review /metadata')
  await expect.element(task.getByText('metadata', { exact: true })).not.toBeInTheDocument()
  await expect.element(menu.getByText('metadata', { exact: true })).toBeVisible()
  await menu.getByText('metadata', { exact: true }).click()
  await expect.element(task.getByText('metadata', { exact: true })).not.toBeInTheDocument()
  await menu.getByText('metadata', { exact: true }).hover()
  await page.getByText('note', { exact: true }).click()
  await expect.element(task.getByText('note', { exact: true })).toBeVisible()
  await expect.element(task).not.toHaveAttribute('aria-invalid')
  await expect.element(panel.getByRole('status')).not.toBeInTheDocument()
})

it('keeps an unsupported reference and its warning through real rebind, saving and reopening until the author removes it', async () => {
  const graph = createTaskVariableGraph()
  graph.nodes = graph.nodes.map((node) =>
    node.id === 'external-agent'
      ? { ...node, data: { ...node.data, agent_task: 'Review {{#policy.risk_score#}}.' } }
      : node,
  )
  const { panel, canvas, unmount } = await setup({ graph })
  const task = panel.getByRole('textbox', { name: 'Agent task', exact: true })
  const warning = 'risk_score has an unsupported type (number).'
  await expect.element(task.getByText('risk_score', { exact: true })).toBeVisible()
  await expect.element(task).toHaveAccessibleDescription(warning)
  await expect.element(task).toHaveAttribute('aria-invalid', 'true')
  await task.getByText('risk_score', { exact: true }).hover()
  await expect.element(page.getByText(warning, { exact: true }).last()).toBeVisible()
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /^Document Review Agent/ }).click()
  await expect.element(canvas.getByText('Document Review Agent', { exact: true })).toBeVisible()
  await expect.element(task.getByText('risk_score', { exact: true })).toBeVisible()
  await expect.element(task).toHaveAccessibleDescription(warning)
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  await expect
    .poll(async () => {
      const saved = await readDraft()
      return (saved.graph as WorkflowDataUpdater).nodes.find((node) => node.id === 'external-agent')
        ?.data
    })
    .toMatchObject({
      agent_task: 'Review {{#policy.risk_score#}}.',
      agent_binding: expect.objectContaining({ agent_id: workflowExternalAgents[1]!.id }),
    })
  const saved = await readDraft()
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(panel).not.toBeInTheDocument()
  await canvas.getByText('Document Review Agent', { exact: true }).click()
  await expect.element(task).toHaveAccessibleDescription(warning)
  await unmount()
  const { panel: restored } = await setup({ graph: saved.graph as WorkflowDataUpdater })
  const restoredTask = restored.getByRole('textbox', { name: 'Agent task', exact: true })
  await expect.element(restoredTask.getByText('risk_score', { exact: true })).toBeVisible()
  await expect.element(restoredTask).toHaveAccessibleDescription(warning)
  await restoredTask.fill('Review the document.')
  await expect.element(restoredTask).not.toHaveAttribute('aria-invalid')
  await expect.element(restored.getByRole('status')).not.toBeInTheDocument()
})
