import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { useEvaluationStore } from '../../store'
import { buildEvaluationTemplateConfigPayload, buildResourceKey } from '../../store-utils'
import ConditionsSection from '../conditions-section'
import FixedMetricsSection from '../fixed-metrics-section'

describe('agent evaluation metrics', () => {
  it('uses checkboxes for fixed metrics and makes a selected metric available to judgment conditions', async () => {
    const user = userEvent.setup()
    const agentId = 'agent-fixed-metrics-1'
    const nodeInfoList = [{ node_id: agentId, title: 'Research Agent', type: 'agent' }]
    const queryClient = createConsoleQueryClient()
    const metricsQueryKey =
      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.defaultMetrics.get.queryKey({
        input: {
          params: { evaluate_target_id: agentId, evaluate_target_type: 'agents' },
          query: { evaluation_framework: 'ragas' },
        },
      })
    queryClient.setQueryData(metricsQueryKey, {
      default_metrics: [
        { metric: 'task_completion', value_type: 'number', node_info_list: nodeInfoList },
        { metric: 'trajectory_quality', value_type: 'number', node_info_list: nodeInfoList },
        {
          metric: 'tool_selection_correctness',
          value_type: 'number',
          node_info_list: nodeInfoList,
        },
        { metric: 'tool_argument_correctness', value_type: 'number', node_info_list: nodeInfoList },
      ],
    })
    act(() => useEvaluationStore.getState().ensureResource('agents', agentId))

    renderWithConsoleQuery(
      <>
        <FixedMetricsSection resourceType="agents" resourceId={agentId} />
        <ConditionsSection resourceType="agents" resourceId={agentId} />
      </>,
      { queryClient },
    )

    const taskCompletion = await screen.findByRole('checkbox', { name: /Task Completion/ })
    expect(screen.getByRole('checkbox', { name: /Trajectory Quality/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Tool Selection Correctness/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Tool Argument Correctness/ })).toBeInTheDocument()
    expect(screen.queryByText('evaluation.metrics.custom.title')).not.toBeInTheDocument()
    const addCondition = screen.getByRole('button', { name: 'evaluation.conditions.addCondition' })
    expect(addCondition).toBeDisabled()
    expect(screen.getByText('evaluation.conditions.emptyDescription')).toBeInTheDocument()

    await user.click(screen.getByText('Task Completion'))
    expect(taskCompletion).toBeChecked()
    expect(addCondition).toBeEnabled()
    expect(screen.queryByText('evaluation.conditions.emptyDescription')).not.toBeInTheDocument()
    expect(screen.getByText('evaluation.conditions.emptyTitle')).toBeInTheDocument()
    const selectedResource =
      useEvaluationStore.getState().resources[buildResourceKey('agents', agentId)]
    if (!selectedResource) throw new Error('Expected agent evaluation state')
    expect(
      buildEvaluationTemplateConfigPayload(selectedResource, 'agents', agentId).default_metrics,
    ).toEqual([{ metric: 'task_completion', value_type: 'number', node_info_list: nodeInfoList }])

    await user.click(addCondition)
    // An agent is its own only node, so the menu lists metrics, not the agent name.
    await user.click(await screen.findByRole('menuitem', { name: /Task Completion/ }))
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()

    await user.click(taskCompletion)
    expect(taskCompletion).not.toBeChecked()
    expect(addCondition).toBeDisabled()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
