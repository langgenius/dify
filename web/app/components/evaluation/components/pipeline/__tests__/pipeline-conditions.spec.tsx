import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { useEvaluationStore } from '../../../store'
import ConditionsSection from '../../conditions-section'
import FixedMetricsSection from '../../fixed-metrics-section'

describe('knowledge evaluation conditions', () => {
  it('adds a judgment condition for a selected metric and removes it when the metric is deselected', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const metricsQueryKey = consoleQuery.datasets.byDatasetId.evaluation.metrics.get.queryKey({
      input: {
        params: { dataset_id: 'dataset-1' },
        query: { evaluation_framework: 'ragas' },
      },
    })
    queryClient.setQueryData(metricsQueryKey, { metrics: ['context_precision'] })
    act(() => useEvaluationStore.getState().ensureResource('datasets', 'dataset-1'))

    renderWithConsoleQuery(
      <>
        <FixedMetricsSection resourceType="datasets" resourceId="dataset-1" />
        <ConditionsSection resourceType="datasets" resourceId="dataset-1" />
      </>,
      { queryClient },
    )

    const metric = await screen.findByRole('checkbox', { name: /Context Precision/ })
    const addCondition = screen.getByRole('button', { name: 'evaluation.conditions.addCondition' })
    expect(addCondition).toBeDisabled()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    await user.click(metric)
    expect(metric).toBeChecked()
    expect(addCondition).toBeEnabled()
    expect(screen.queryByText('evaluation.pipeline.passIf')).not.toBeInTheDocument()

    await user.click(addCondition)
    await user.click(await screen.findByRole('menuitem', { name: /Context Precision/ }))
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()

    await user.click(metric)
    expect(metric).not.toBeChecked()
    expect(addCondition).toBeDisabled()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
