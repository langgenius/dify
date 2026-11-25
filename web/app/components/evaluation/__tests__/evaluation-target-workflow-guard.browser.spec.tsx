import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import evaluation from '@/i18n/locales/en-US/evaluation.json'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { setupFakeApi } from '@/test/fake-api'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createTestQueryClient } from '@/test/query-client'
import EvaluationTargetWorkflowGuard from '../evaluation-target-workflow-guard'

const TARGET_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d'
vi.unmock('react-i18next')

const startWorkflow = createWorkflowResponseFixture({
  graph: { nodes: [{ id: 'start-1', data: { type: 'start', variables: [] } }], edges: [] },
})
const triggerWorkflow = createWorkflowResponseFixture({
  graph: { nodes: [{ id: 'webhook-1', data: { type: 'trigger-webhook' } }], edges: [] },
})

const fake = setupFakeApi(() => ({
  console: {
    apps: { byAppId: { workflows: { publish: { get: async () => startWorkflow } } } },
    snippets: { bySnippetId: { workflows: { publish: { get: async () => startWorkflow } } } },
  },
}))

async function renderGuard(resourceType: 'apps' | 'snippets') {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common, evaluation } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })

  return render(
    <QueryClientTestProvider queryClient={createTestQueryClient()}>
      <I18nextProvider i18n={i18n}>
        <EvaluationTargetWorkflowGuard resourceType={resourceType} resourceId={TARGET_ID}>
          <button type="button">Run evaluation</button>
        </EvaluationTargetWorkflowGuard>
      </I18nextProvider>
    </QueryClientTestProvider>,
  )
}

it('blocks a published trigger workflow before showing app evaluation controls', async () => {
  fake.console.apps.byAppId.workflows.publish.get.mockResolvedValue(triggerWorkflow)
  const screen = await renderGuard('apps')

  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent(
      'Trigger-started workflows cannot be evaluated. Publish a workflow with a User Input start node.',
    )
  await expect
    .element(screen.getByRole('button', { name: 'Run evaluation' }))
    .not.toBeInTheDocument()
})

it('blocks a published trigger workflow before showing snippet evaluation controls', async () => {
  fake.console.snippets.bySnippetId.workflows.publish.get.mockResolvedValue(triggerWorkflow)
  const screen = await renderGuard('snippets')

  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent(
      'Trigger-started workflows cannot be evaluated. Publish a workflow with a User Input start node.',
    )
  await expect
    .element(screen.getByRole('button', { name: 'Run evaluation' }))
    .not.toBeInTheDocument()
})

it('keeps evaluation available for a Start node with no input variables', async () => {
  const screen = await renderGuard('apps')

  await expect.element(screen.getByRole('button', { name: 'Run evaluation' })).toBeVisible()
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
})
