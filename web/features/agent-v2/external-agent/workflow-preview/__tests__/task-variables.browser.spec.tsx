import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { InputVar, WorkflowDataUpdater } from '@/app/components/workflow/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { externalWorkflowAgentExamples } from '@/app/components/workflow/block-selector/workflow-agent-selector-preview'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { consoleClient } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { isExternalAgentWorkflowPreviewData } from '../types'
import {
  createExternalAgentWorkflowGraph,
  createSerializedWorkflowDraftStorage,
  renderExternalAgentWorkflow,
} from './preview-browser-fixture'
import 'reactflow/dist/style.css'

// boundary: use the fixture's real I18nextProvider resources instead of the global translator double.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const draftApi = vi.hoisted(() => ({
  save: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.post>(),
  read: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.get>(),
}))

// boundary: replace backend storage while retaining real variable lookup, editing, and draft serialization.
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

function createTaskVariableGraph(documentAgent = false) {
  const agent = externalWorkflowAgentExamples[1]!
  const graph = createExternalAgentWorkflowGraph({
    nodeData: documentAgent ? { external_agent: agent, title: agent.name } : {},
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
})

it('limits Text-only task insertion to strings and guards object selection with both mouse and keyboard', async () => {
  const { panel } = await setup()
  const task = panel.getByRole('textbox', { name: 'Agent task', exact: true })
  await task.fill('Review ')
  await userEvent.keyboard('/')
  const menu = page.getByRole('listbox', { name: 'Typeahead menu', exact: true })
  await expect.element(menu.getByText('contract_text', { exact: true })).toBeVisible()
  await expect.element(menu.getByText('result', { exact: true })).toBeVisible()
  for (const name of ['risk_score', 'approved', 'empty_object', 'attached_files']) {
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

it('preserves a file reference while warning after an incompatible agent switch and clears the warning when supported or removed', async () => {
  const { panel, canvas, unmount } = await setup({
    graph: createTaskVariableGraph(true),
    name: 'Document Review Agent',
  })
  const task = panel.getByRole('textbox', { name: 'Agent task', exact: true })
  await task.fill('Review ')
  await userEvent.keyboard('/')
  const menu = page.getByRole('listbox', { name: 'Typeahead menu', exact: true })
  await expect.element(menu.getByText('attached_files', { exact: true })).toBeVisible()
  await menu.getByText('document_file', { exact: true }).click()
  await expect.element(task.getByText('document_file', { exact: true })).toBeVisible()
  await expect.element(task).not.toHaveAttribute('aria-invalid')
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /^Contract Review Agent/ }).click()
  const contract = page.getByRole('region', { name: 'Contract Review Agent', exact: true })
  const contractTask = contract.getByRole('textbox', { name: 'Agent task', exact: true })
  const token = contractTask.getByText('document_file', { exact: true })
  const warning = 'document_file has an unsupported type (file).'
  await expect.element(token).toBeVisible()
  await expect.element(contractTask).toHaveAttribute('aria-invalid', 'true')
  await expect.element(contractTask).toHaveAccessibleDescription(warning)
  await expect.element(contract.getByRole('status')).toHaveTextContent(warning)
  await expect.poll(() => page.getByText(warning, { exact: true }).all().length).toBe(1)
  await token.hover()
  await expect.poll(() => page.getByText(warning, { exact: true }).all().length).toBe(2)
  await expect.element(page.getByText(warning, { exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  await expect
    .poll(async () => {
      const saved = await readDraft()
      const node = (saved.graph as WorkflowDataUpdater).nodes.find(
        (node) => node.id === 'external-agent',
      )
      return node && isExternalAgentWorkflowPreviewData(node.data)
        ? node.data.agent_task
        : undefined
    })
    .toContain('{{#input.document_file#}}')
  const saved = await readDraft()
  await contract.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(contract).not.toBeInTheDocument()
  await canvas.getByText('Contract Review Agent', { exact: true }).click()
  await expect.element(contract.getByRole('status')).toHaveTextContent(warning)
  await expect.element(token).toBeVisible()
  await unmount()
  await expect.element(contract).not.toBeInTheDocument()
  const { panel: restored } = await setup({ graph: saved.graph as WorkflowDataUpdater })
  const restoredTask = restored.getByRole('textbox', { name: 'Agent task', exact: true })
  await expect.element(restoredTask.getByText('document_file', { exact: true })).toBeVisible()
  await expect.element(restored.getByRole('status')).toHaveTextContent(warning)
  await restored.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /^Document Review Agent/ }).click()
  const document = page.getByRole('region', { name: 'Document Review Agent', exact: true })
  const documentTask = document.getByRole('textbox', { name: 'Agent task', exact: true })
  await expect.element(documentTask.getByText('document_file', { exact: true })).toBeVisible()
  await expect.element(documentTask).not.toHaveAttribute('aria-invalid')
  await expect.element(document.getByRole('status')).not.toBeInTheDocument()
  await documentTask.getByText('document_file', { exact: true }).hover()
  await expect.element(page.getByText(warning, { exact: true })).not.toBeInTheDocument()
  await document.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /^Contract Review Agent/ }).click()
  const current = page.getByRole('region', { name: 'Contract Review Agent', exact: true })
  const currentTask = current.getByRole('textbox', { name: 'Agent task', exact: true })
  await expect.element(current.getByRole('status')).toHaveTextContent(warning)
  await currentTask.click()
  await userEvent.keyboard(
    /Mac/.test(navigator.userAgent) ? '{Meta>}a{/Meta}' : '{Control>}a{/Control}',
  )
  await userEvent.keyboard('{Backspace}')
  await expect.element(currentTask).toHaveTextContent('')
  await expect.element(currentTask).not.toHaveAttribute('aria-invalid')
  await expect.element(current.getByRole('status')).not.toBeInTheDocument()
  await currentTask.fill('Review the document.')
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  await expect
    .poll(async () => {
      const saved = await readDraft()
      const node = (saved.graph as WorkflowDataUpdater).nodes.find(
        (node) => node.id === 'external-agent',
      )
      return node && isExternalAgentWorkflowPreviewData(node.data)
        ? node.data.agent_task
        : undefined
    })
    .toBe('Review the document.')
})
