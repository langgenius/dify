import type { EvaluationNodeInfoResponse } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import evaluation from '@/i18n/locales/en-US/evaluation.json'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import EvaluationNodeNameNotice from '../evaluation-node-name-notice'

const api = vi.hoisted(() => ({
  nodeInfo: vi.fn<() => Promise<EvaluationNodeInfoResponse>>(),
}))

vi.unmock('react-i18next')
// boundary: The evaluation node-info API supplies metric-capable nodes from the published version.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'byEvaluateTargetType.byEvaluateTargetId.evaluation.nodeInfo.post': api.nodeInfo,
    }),
  }
})

const duplicateNodes: EvaluationNodeInfoResponse = {
  all: [
    { node_id: 'llm-1', type: 'llm', title: 'Answer' },
    { node_id: 'llm-2', type: 'llm', title: 'Answer' },
  ],
}

const distinctNodes: EvaluationNodeInfoResponse = {
  all: [
    { node_id: 'llm-1', type: 'llm', title: 'Answer' },
    { node_id: 'llm-2', type: 'llm', title: 'Summarize' },
  ],
}

async function renderNotice(resourceType: 'apps' | 'snippets') {
  onTestFinished(guardUnexpectedFetch())
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
        <EvaluationNodeNameNotice resourceType={resourceType} resourceId="target-1">
          <p>Evaluation ready</p>
        </EvaluationNodeNameNotice>
      </I18nextProvider>
    </QueryClientTestProvider>,
  )
}

beforeEach(() => api.nodeInfo.mockReset())

it('opens app evaluation and warns about duplicate node names in a dismissible dialog', async () => {
  api.nodeInfo.mockResolvedValue(duplicateNodes)
  const screen = await renderNotice('apps')

  const dialog = screen.getByRole('dialog', { name: 'Duplicate node names' })
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog.getByText(/same name \(Answer\)/)).toBeVisible()
  await expect.element(screen.getByText('Evaluation ready')).toBeInTheDocument()
  expect(api.nodeInfo).toHaveBeenCalledWith({
    params: { evaluate_target_type: 'apps', evaluate_target_id: 'target-1' },
    body: { metrics: [] },
  })

  await userEvent.click(dialog.getByRole('button', { name: 'Close' }).last())
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('Evaluation ready')).toBeVisible()
})

it('opens evaluation without a notice when published node names are distinct', async () => {
  api.nodeInfo.mockResolvedValue(distinctNodes)
  const screen = await renderNotice('apps')

  await expect.element(screen.getByText('Evaluation ready')).toBeVisible()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('also warns for duplicate metric-capable snippet nodes without blocking evaluation', async () => {
  api.nodeInfo.mockResolvedValue(duplicateNodes)
  const screen = await renderNotice('snippets')

  await expect.element(screen.getByRole('dialog', { name: 'Duplicate node names' })).toBeVisible()
  await expect.element(screen.getByText('Evaluation ready')).toBeInTheDocument()
})

it('keeps evaluation available and lets users retry a failed node-name check', async () => {
  api.nodeInfo
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValue(distinctNodes)
  const screen = await renderNotice('apps')

  const dialog = screen.getByRole('dialog', { name: 'Something went wrong' })
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog.getByText(/could not be checked/)).toBeVisible()
  await expect.element(screen.getByText('Evaluation ready')).toBeInTheDocument()

  await userEvent.click(dialog.getByRole('button', { name: 'Try Again' }))

  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.nodeInfo).toHaveBeenCalledTimes(2)
  await expect.element(screen.getByText('Evaluation ready')).toBeVisible()
})
