import type { ExternalAgentWorkflowPreviewNodeData } from '../types'
import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import { page } from 'vite-plus/test/browser'
import { consoleClient } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
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

// boundary: replace backend draft storage while keeping canvas edits and serialization real.
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

async function setup() {
  const rendered = await renderExternalAgentWorkflow()
  onTestFinished(() => {
    rendered.workflowStore.getState().debouncedSyncWorkflowDraft.cancel?.()
    rendered.queryClient.clear()
  })
  await expect.element(rendered.panel).toBeVisible()
  return rendered
}

const readDraft = () =>
  consoleClient.apps.byAppId.workflows.draft.get({ params: { app_id: 'external-preview-app' } })

async function saveDraft(expected: Partial<ExternalAgentWorkflowPreviewNodeData>) {
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  await expect
    .poll(async () => {
      const saved = await readDraft()
      return (saved.graph as WorkflowDataUpdater).nodes.find((node) => node.id === 'external-agent')
        ?.data
    })
    .toMatchObject(expected)
  return readDraft()
}

beforeEach(({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  const storage = createSerializedWorkflowDraftStorage()
  draftApi.save.mockImplementation(storage.save)
  draftApi.read.mockImplementation(storage.read)
})

it('opens read-only Contract Review details and returns focus without changing the saved draft', async () => {
  const { panel } = await setup()
  await page.viewport(1223, 772)
  const task = 'Keep the existing contract review instructions.'
  await panel.getByRole('textbox', { name: 'Agent task', exact: true }).fill(task)
  const before = await saveDraft({ agent_task: task })
  const savesBefore = draftApi.save.mock.calls.length
  const trigger = panel.getByRole('button', { name: /^Contract Review Agent/ })
  await trigger.click()
  const details = page.getByRole('dialog', { name: 'Agent details', exact: true })
  await expect.element(details).toBeVisible()
  await expect
    .element(details.getByRole('heading', { name: 'Contract Review Agent', exact: true }))
    .toBeVisible()
  await expect.element(details.getByRole('heading', { name: /^Agent skills/ })).toBeVisible()
  await expect.element(details.getByRole('heading', { name: /^Used in apps/ })).toBeVisible()
  await expect
    .element(details.getByRole('heading', { name: 'Connection', exact: true }))
    .toBeVisible()
  await expect
    .element(details.getByRole('heading', { name: 'Service details', exact: true }))
    .toBeVisible()
  await expect.element(details.getByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
  await expect.element(details.getByRole('switch')).not.toBeInTheDocument()
  await expect.element(details.getByText('Tracing on', { exact: true })).toBeVisible()
  const description = details.getByText(
    'Reads a contract clause by clause and flags terms that conflict with your policies.',
    { exact: true },
  )
  const skill = details.getByRole('button', { name: 'Contract review', exact: true })
  await expect.element(description).toBeVisible()
  await skill.click()
  await expect.element(skill).toHaveAttribute('aria-expanded', 'false')
  await skill.click()
  await expect.element(skill).toHaveAttribute('aria-expanded', 'true')
  await expect.element(description).toBeVisible()
  await details.getByRole('button', { name: 'Example requests', exact: true }).first().click()
  await expect
    .element(
      details.getByText('Review this payment clause and suggest a safer alternative.', {
        exact: true,
      }),
    )
    .toBeVisible()
  const connection = details.getByRole('button', { name: 'Connection', exact: true })
  const endpoint = details.getByText('https://agents.acme.example/contract-review', { exact: true })
  await connection.click()
  await expect.element(connection).toHaveAttribute('aria-expanded', 'false')
  await connection.click()
  await expect.element(connection).toHaveAttribute('aria-expanded', 'true')
  await expect.element(endpoint).toBeVisible()
  await details.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(details).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  expect((await readDraft()).graph).toEqual(before.graph)
  expect(draftApi.save).toHaveBeenCalledTimes(savesBefore)
})

it('keeps Change as an agent picker and opens the selected Document Review identity and skills', async () => {
  const { panel } = await setup()
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: /^Document Review Agent/ }).click()
  const changed = page.getByRole('region', { name: 'Document Review Agent', exact: true })
  await expect.element(changed).toBeVisible()
  const before = await saveDraft({ title: 'Document Review Agent' })
  const savesBefore = draftApi.save.mock.calls.length
  const trigger = changed.getByRole('button', { name: /^Document Review Agent/ })
  await trigger.click()
  const details = page.getByRole('dialog', { name: 'Agent details', exact: true })
  await expect
    .element(details.getByRole('heading', { name: 'Document Review Agent', exact: true }))
    .toBeVisible()
  await expect
    .element(details.getByRole('button', { name: 'Document review', exact: true }))
    .toBeVisible()
  await expect
    .element(details.getByText('https://agents.acme.example/document-review', { exact: true }))
    .toBeVisible()
  await expect
    .element(details.getByRole('button', { name: 'Contract review', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(details.getByRole('button', { name: 'Clause rewrite', exact: true }))
    .not.toBeInTheDocument()
  await details.getByRole('button', { name: 'Example requests', exact: true }).click()
  await expect
    .element(
      details.getByText(
        'Review this document and summarize the information that needs attention.',
        { exact: true },
      ),
    )
    .toBeVisible()
  await details.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.element(details).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await page.getByRole('button', { name: 'Save workflow draft', exact: true }).click()
  expect((await readDraft()).graph).toEqual(before.graph)
  expect(draftApi.save).toHaveBeenCalledTimes(savesBefore)
})
