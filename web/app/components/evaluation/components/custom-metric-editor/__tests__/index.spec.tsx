import { act, screen } from '@testing-library/react'
import { buildStateFromEvaluationConfig } from '@/app/components/evaluation/store-utils'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import CustomMetricEditorCard from '../index'

describe('CustomMetricEditorCard', () => {
  it('leaves the saved evaluator label empty until its name is resolved', async () => {
    const metric = buildStateFromEvaluationConfig('agents', 'agent-1', {
      customized_metrics: {
        evaluation_workflow_id: 'evaluator-app',
        input_fields: {},
        output_fields: [],
      },
    }).metrics[0]
    if (!metric) throw new Error('Expected the saved custom evaluator')

    const queryClient = createConsoleQueryClient()
    const evaluatorAppQueryKey = consoleQuery.apps.byAppId.get.queryKey({
      input: { params: { app_id: 'evaluator-app' } },
    })
    const publishedWorkflowQueryKey = consoleQuery.apps.byAppId.workflows.publish.get.queryKey({
      input: { params: { app_id: 'evaluator-app' } },
    })
    const pending = new Promise<never>(() => {})
    void queryClient.query({ queryKey: evaluatorAppQueryKey, queryFn: () => pending })
    void queryClient.query({ queryKey: publishedWorkflowQueryKey, queryFn: () => pending })

    renderWithConsoleQuery(
      <CustomMetricEditorCard resourceType="agents" resourceId="agent-1" metric={metric} />,
      { queryClient },
    )

    const selector = screen.getByRole('button', {
      name: 'evaluation.metrics.custom.workflowLabel',
    })
    expect(selector.textContent?.trim()).toBe('')

    await act(async () => {
      seedAppDetail(
        queryClient,
        createAppDetailFixture({ id: 'evaluator-app', name: 'Quality Checker', mode: 'workflow' }),
      )
    })
    expect(selector.textContent?.trim()).toBe('')

    await act(async () => {
      queryClient.setQueryData(
        publishedWorkflowQueryKey,
        createWorkflowResponseFixture({ marked_name: '' }),
      )
    })
    expect(selector).toHaveTextContent('Quality Checker')
  })
})
