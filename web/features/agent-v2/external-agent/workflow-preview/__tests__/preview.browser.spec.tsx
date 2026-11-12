import { ORPCError } from '@orpc/client'
import { page, userEvent } from 'vite-plus/test/browser'
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
  rebind:
    vi.fn<
      typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.externalAgentBindings.byNodeId.rebind.post
    >(),
}))

// boundary: keep draft serialization and hydration real, replacing only backend storage.
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

async function setup(...args: Parameters<typeof renderExternalAgentWorkflow>) {
  const rendered = await renderExternalAgentWorkflow(...args)
  onTestFinished(() => {
    rendered.workflowStore.getState().debouncedSyncWorkflowDraft.cancel?.()
    rendered.queryClient.clear()
  })
  await expect.element(rendered.panel).toBeVisible()
  return rendered
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
  const reopened = page.getByRole('region', { name: /Node configuration panel$/ })
  await expect.element(reopened).toBeVisible()
  return reopened
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  const storage = createSerializedWorkflowDraftStorage()
  draftApi.save.mockImplementation(storage.save)
  draftApi.read.mockImplementation(storage.read)
  draftApi.rebind.mockImplementation(storage.rebind)
})

it('shows the external badge and updates the canvas agent through the change picker without Dify APIs', async () => {
  const { panel, canvas } = await setup()
  await expect.element(panel.getByText('External', { exact: true })).toBeVisible()
  await expect.element(canvas.getByText('External', { exact: true })).toBeVisible()
  await expect
    .element(panel.getByRole('tab', { name: 'SETTINGS', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(panel.getByRole('button', { name: /Run this step/i })).toBeEnabled()
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /Document Review Agent/ }).click()
  const changedPanel = page.getByRole('region', {
    name: 'Contract Review Agent Node configuration panel',
    exact: true,
  })
  await expect.element(changedPanel).toBeVisible()
  await expect
    .element(changedPanel.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toHaveTextContent('')
  await expect.element(canvas.getByText('Document Review Agent', { exact: true })).toBeVisible()
  expect(draftApi.rebind).toHaveBeenCalledWith({
    params: { app_id: 'external-preview-app', node_id: 'external-agent' },
    body: {
      target_agent_id: '44444444-4444-4444-8444-444444444444',
      expected_hash: 'saved-1',
      include_matching: true,
    },
  })
  expect(draftApi.save.mock.invocationCallOrder[0]).toBeLessThan(
    draftApi.rebind.mock.invocationCallOrder[0]!,
  )
  expect(draftApi.rebind.mock.invocationCallOrder[0]).toBeLessThan(
    draftApi.read.mock.invocationCallOrder.at(-1)!,
  )
  await expect
    .element(canvas.getByText('Contract Review Agent', { exact: true }))
    .not.toBeInTheDocument()
  await closeAndReopen(changedPanel, 'Document Review Agent')
})

it('keeps the current binding and author edits when rebind conflicts after saving the latest draft', async () => {
  const { panel, canvas } = await setup()
  const task = panel.getByRole('textbox', { name: 'Agent task', exact: true })
  await task.fill('Keep these instructions when the binding conflicts.')
  draftApi.rebind.mockRejectedValueOnce(new ORPCError('CONFLICT', { status: 409 }))
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /^Document Review Agent/ }).click()
  await expect
    .element(panel.getByRole('alert'))
    .toHaveTextContent('Could not change the agent. Your task and settings have been kept.')
  await userEvent.keyboard('{Escape}')
  await expect
    .element(task)
    .toHaveTextContent('Keep these instructions when the binding conflicts.')
  await expect.element(canvas.getByText('Contract Review Agent', { exact: true })).toBeVisible()
  expect(draftApi.rebind).toHaveBeenCalledTimes(1)
  expect(draftApi.save.mock.calls.at(-1)?.[0].body.graph).toMatchObject({
    nodes: expect.arrayContaining([
      expect.objectContaining({
        id: 'external-agent',
        data: expect.objectContaining({
          agent_task: 'Keep these instructions when the binding conflicts.',
          agent_binding: expect.objectContaining({
            agent_id: '22222222-2222-4222-8222-222222222222',
          }),
        }),
      }),
    ]),
  })
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

it('removes only the failure connection when disabling error handling', async () => {
  const { panel, canvas } = await setup({
    graph: createExternalAgentWorkflowGraph({ withErrorBranches: true }),
  })
  for (const name of ['Failure connection', 'Normal connection', 'Unrelated connection']) {
    await expect.element(canvas.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await panel.getByRole('button', { name: 'Fail Branch', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^None/ }).click()
  await expect
    .element(canvas.getByRole('button', { name: 'Failure connection', exact: true }))
    .not.toBeInTheDocument()
  for (const name of ['Normal connection', 'Unrelated connection']) {
    await expect.element(canvas.getByRole('button', { name, exact: true })).toBeVisible()
  }
  const reopened = await closeAndReopen(panel)
  await expect.element(reopened.getByRole('button', { name: 'None', exact: true })).toBeVisible()
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
  await expect.element(retries).toHaveValue('1')
  await expect.element(interval).toHaveValue('5')
  await retries.fill('2')
  await userEvent.tab()
  await interval.fill('45')
  await userEvent.tab()
  await expect
    .element(panel.getByRole('slider', { name: 'Max retries', exact: true }))
    .toHaveAttribute('aria-valuenow', '2')
  await expect
    .element(panel.getByRole('slider', { name: 'Retry interval', exact: true }))
    .toHaveAttribute('aria-valuenow', '45')

  await timeout.click()
  await page.getByRole('option', { name: 'End waiting', exact: true }).click()
  await expect.element(retries).not.toBeInTheDocument()
  await expect.element(interval).not.toBeInTheDocument()
  await timeout.click()
  await page.getByRole('option', { name: 'Cancel and retry', exact: true }).click()
  await expect.element(retries).toHaveValue('2')
  await expect.element(interval).toHaveValue('45')

  const enabled = panel.getByRole('switch', { name: 'External agent wait limit', exact: true })
  await enabled.click()
  await expect.element(timeout).not.toBeInTheDocument()
  await enabled.click()
  await expect.element(timeout).toHaveTextContent('Cancel and retry')
  await expect.element(retries).toHaveValue('2')
  await expect.element(interval).toHaveValue('45')
  const reopened = await closeAndReopen(panel)
  await expect
    .element(reopened.getByRole('combobox', { name: 'On timeout', exact: true }))
    .toHaveTextContent('Cancel and retry')
  await expect
    .element(reopened.getByRole('textbox', { name: 'Max retries', exact: true }))
    .toHaveValue('2')
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
  await expect.element(panel.getByText('text', { exact: true })).toBeVisible()
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

it('shows the empty Last Run tab using the existing execution record API', async () => {
  const { panel } = await setup()
  await panel.getByRole('tab', { name: 'LAST RUN', exact: true }).click()
  await expect
    .element(panel.getByText('The results of the last run will be displayed here', { exact: true }))
    .toBeVisible()
  await panel.getByRole('tab', { name: 'SETTINGS', exact: true }).click()
  await expect
    .element(panel.getByRole('textbox', { name: 'Agent task', exact: true }))
    .toBeVisible()
})
