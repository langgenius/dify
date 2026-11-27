import type { EvaluationRunDetailResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import evaluation from '@/i18n/locales/en-US/evaluation.json'
import { consoleQuery } from '@/service/console'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { useEvaluationStore } from '../../../store'
import PipelineResultsPreview from '../pipeline-results-preview'

vi.unmock('react-i18next')

it('shows the run model after the editable evaluation model changes', async () => {
  onTestFinished(guardUnexpectedFetch())
  const resourceId = 'dataset-1'
  const runId = 'run-1'
  const queryClient = createTestQueryClient(() => new Promise(() => {}))
  const detail: EvaluationRunDetailResponse = {
    run: {
      id: runId,
      tenant_id: 'tenant-1',
      target_type: 'knowledge_base',
      target_id: resourceId,
      evaluation_config_id: 'config-1',
      evaluation_model: 'run-model',
      evaluation_model_provider: 'run-provider',
      status: 'completed',
      total_items: 0,
      completed_items: 0,
      failed_items: 0,
      progress: 100,
      created_by: 'user-1',
    },
    items: { data: [], page: 1, page_size: 100, total: 0 },
  }
  queryClient.setQueryData(
    consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.get.queryKey({
      input: {
        params: { dataset_id: resourceId, run_id: runId },
        query: { page: 1, page_size: 100 },
      },
    }),
    detail,
  )
  useEvaluationStore.getState().ensureResource('datasets', resourceId)
  useEvaluationStore
    .getState()
    .setJudgeModel('datasets', resourceId, 'current-provider::current-model')
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { evaluation } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })

  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <I18nextProvider i18n={i18n}>
        <PipelineResultsPreview resourceType="datasets" resourceId={resourceId} runId={runId} />
      </I18nextProvider>
    </QueryClientTestProvider>,
  )

  await expect.element(screen.getByText('run-model')).toBeVisible()
  await expect.element(screen.getByText('current-model')).not.toBeInTheDocument()
})
