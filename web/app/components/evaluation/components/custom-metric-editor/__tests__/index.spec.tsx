import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildStateFromEvaluationConfig } from '@/app/components/evaluation/store-utils'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import CustomMetricEditorCard from '../index'

const loadPublishedWorkflow = vi.hoisted(() =>
  vi.fn<() => Promise<unknown>>(() => new Promise(() => {})),
)

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.publish.get': loadPublishedWorkflow,
    }),
  }
})

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

  it('says why the evaluator inputs failed to load instead of asking to finish the mapping', async () => {
    const user = userEvent.setup()
    loadPublishedWorkflow.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 400 }), { message: 'Evaluator unavailable' }),
    )
    loadPublishedWorkflow.mockResolvedValueOnce(createWorkflowResponseFixture({ marked_name: '' }))
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

    renderWithConsoleQuery(
      <CustomMetricEditorCard resourceType="agents" resourceId="agent-1" metric={metric} />,
      { queryClient },
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Evaluator unavailable')
    expect(screen.queryByText('evaluation.metrics.custom.mappingWarning')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(loadPublishedWorkflow).toHaveBeenCalledTimes(2)
  })
})
