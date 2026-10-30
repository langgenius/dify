import { screen } from '@testing-library/react'
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
  it('shows the saved evaluator app name after restoring the configuration', () => {
    const metric = buildStateFromEvaluationConfig('agents', 'agent-1', {
      customized_metrics: {
        evaluation_workflow_id: 'evaluator-app',
        input_fields: {},
        output_fields: [],
      },
    }).metrics[0]
    if (!metric) throw new Error('Expected the saved custom evaluator')

    const queryClient = createConsoleQueryClient()
    seedAppDetail(
      queryClient,
      createAppDetailFixture({ id: 'evaluator-app', name: 'Quality Checker', mode: 'workflow' }),
    )
    queryClient.setQueryData(
      consoleQuery.apps.byAppId.workflows.publish.get.queryKey({
        input: { params: { app_id: 'evaluator-app' } },
      }),
      createWorkflowResponseFixture({ marked_name: '' }),
    )

    renderWithConsoleQuery(
      <CustomMetricEditorCard resourceType="agents" resourceId="agent-1" metric={metric} />,
      { queryClient },
    )

    expect(
      screen.getByRole('button', { name: 'evaluation.metrics.custom.workflowLabel' }),
    ).toHaveTextContent('Quality Checker')
  })
})
