import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { consoleClient } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  createExternalAgentWorkflowGraph,
  createSerializedWorkflowDraftStorage,
  renderExternalAgentWorkflow,
} from './preview-browser-fixture'
import 'reactflow/dist/style.css'

// boundary: use the fixture’s real I18nextProvider resources instead of the global translator double.
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

async function setup(...args: Parameters<typeof renderExternalAgentWorkflow>) {
  const rendered = await renderExternalAgentWorkflow(...args)
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
  const expectedGraph = {
    nodes: expect.arrayContaining([
      expect.objectContaining({
        id: 'external-agent',
        data: expect.objectContaining({
          agent_node_kind: 'external_agent',
          external_agent: expect.objectContaining({ name: 'Document Review Agent' }),
          agent_task: 'Review the saved contract.',
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
  }
  await expect
    .poll(async () => {
      const saved = await readDraft()
      const graph = saved.graph as WorkflowDataUpdater
      const agent = graph.nodes.find((node) => node.id === 'external-agent')
      return { graph, strategy: agent?.data.error_strategy, defaults: agent?.data.default_value }
    })
    .toMatchObject({ graph: expectedGraph, strategy: undefined, defaults: undefined })
  const saved = await readDraft()
  expect(saved.graph).toMatchObject(expectedGraph)
  const savedGraph = saved.graph as WorkflowDataUpdater
  const savedAgent = savedGraph.nodes.find((node) => node.id === 'external-agent')
  expect(savedAgent?.data).not.toHaveProperty('error_strategy')
  expect(savedAgent?.data).not.toHaveProperty('default_value')
  await unmount()
  await expect.element(changed).not.toBeInTheDocument()
  const { panel: restored, canvas } = await setup({
    graph: savedGraph,
    name: 'Document Review Agent',
  })
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

it('saves an edited default output, removes only the failure connection, and restores both from the draft', async () => {
  const { panel, canvas, unmount } = await setup({
    graph: createExternalAgentWorkflowGraph({ withErrorBranches: true }),
  })
  for (const name of ['Failure connection', 'Normal connection', 'Unrelated connection']) {
    await expect.element(canvas.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await panel.getByRole('button', { name: 'Fail Branch', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Default Value/ }).click()
  const fallback = panel.getByRole('textbox', { name: 'text', exact: true })
  await expect.element(fallback).toHaveValue('')
  await expect
    .element(canvas.getByRole('button', { name: 'Failure connection', exact: true }))
    .not.toBeInTheDocument()
  for (const name of ['Normal connection', 'Unrelated connection']) {
    await expect.element(canvas.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await fallback.fill('The contract could not be reviewed. Please try again.')
  await panel.getByText('text', { exact: true }).first().hover()
  await panel.getByRole('button', { name: 'Edit text', exact: true }).click()
  await panel.getByRole('textbox', { name: 'Field name', exact: true }).fill('summary')
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .element(panel.getByRole('textbox', { name: 'summary', exact: true }))
    .toHaveValue('The contract could not be reviewed. Please try again.')
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  const defaultValue = [
    {
      key: 'summary',
      type: 'string',
      value: 'The contract could not be reviewed. Please try again.',
    },
  ]
  await expect
    .poll(async () => {
      const saved = await readDraft()
      return (saved.graph as WorkflowDataUpdater).nodes.find((node) => node.id === 'external-agent')
        ?.data.default_value
    })
    .toEqual(defaultValue)
  const saved = await readDraft()
  const savedGraph = saved.graph as WorkflowDataUpdater
  expect(savedGraph.nodes.find((node) => node.id === 'external-agent')?.data).toMatchObject({
    error_strategy: 'default-value',
    default_value: defaultValue,
    agent_declared_outputs: expect.arrayContaining([expect.objectContaining({ name: 'summary' })]),
  })
  expect(savedGraph.edges.map((edge) => edge.id)).toEqual(
    expect.arrayContaining(['normal-connection', 'unrelated-connection']),
  )
  expect(savedGraph.edges.map((edge) => edge.id)).not.toContain('failure-connection')
  await unmount()
  await expect.element(panel).not.toBeInTheDocument()
  const { panel: restored, canvas: restoredCanvas } = await setup({ graph: savedGraph })
  await expect
    .element(restored.getByRole('button', { name: 'Default Value', exact: true }))
    .toBeVisible()
  await expect
    .element(restored.getByRole('textbox', { name: 'summary', exact: true }))
    .toHaveValue(defaultValue[0]!.value)
  await expect
    .element(restoredCanvas.getByRole('button', { name: 'Failure connection', exact: true }))
    .not.toBeInTheDocument()
  for (const name of ['Normal connection', 'Unrelated connection']) {
    await expect.element(restoredCanvas.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await restored.getByRole('button', { name: 'Default Value', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Fail Branch/ }).click()
  await expect
    .element(restored.getByRole('textbox', { name: 'summary', exact: true }))
    .not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  await expect
    .poll(async () => {
      const saved = await readDraft()
      return (saved.graph as WorkflowDataUpdater).nodes.find((node) => node.id === 'external-agent')
        ?.data
    })
    .toMatchObject({ error_strategy: 'fail-branch' })
  const failBranchDraft = await readDraft()
  expect(
    (failBranchDraft.graph as WorkflowDataUpdater).nodes.find(
      (node) => node.id === 'external-agent',
    )?.data,
  ).not.toHaveProperty('default_value')
})

it('edits a boolean output fallback through its switch and saves the boolean value', async () => {
  const { panel } = await setup({
    graph: createExternalAgentWorkflowGraph({
      nodeData: {
        agent_declared_outputs: [{ name: 'approved', type: 'boolean', required: false }],
      },
    }),
  })
  await panel.getByRole('button', { name: 'Fail Branch', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Default Value/ }).click()
  const approved = panel.getByRole('switch', { name: 'approved', exact: true })
  await expect.element(approved).not.toBeChecked()
  await approved.click()
  await expect.element(approved).toBeChecked()
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  await expect
    .poll(async () => {
      const saved = await readDraft()
      return (saved.graph as WorkflowDataUpdater).nodes.find((node) => node.id === 'external-agent')
        ?.data.default_value
    })
    .toEqual([{ key: 'approved', type: 'boolean', value: true }])
})
