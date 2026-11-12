import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { consoleClient } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
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
  const { panel: restored, canvas } = await setup({
    graph: saved.graph as WorkflowDataUpdater,
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
