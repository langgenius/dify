import type { EvaluationRunItemResponse } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PipelineResultsTable from '../pipeline-results-table'

const longQuery = 'Explain the complete evaluation input and preserve every detail. '
  .repeat(8)
  .trim()

const item: EvaluationRunItemResponse = {
  id: 'item-1',
  item_index: 0,
  inputs: { query: longQuery },
  expected_output: 'Expected result with all details',
  actual_output: 'Actual result with all details',
  metrics: [{ name: 'accuracy', value: 'Metric details with full context' }],
  overall_score: 1,
}

describe('evaluation result cell disclosure', () => {
  it('shows full cell content in a popover inside the result dialog', async () => {
    const user = userEvent.setup()
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Results</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <PipelineResultsTable
              items={[item]}
              metricColumns={[{ id: 'accuracy', metricName: 'accuracy', label: 'Accuracy' }]}
              isLoading={false}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Results' })
    const queryTrigger = within(dialog).getByRole('button', {
      name: 'common.operation.viewDetails: evaluation.results.columns.query',
    })
    await user.hover(queryTrigger)

    const fullQuery = await screen.findByRole('dialog', {
      name: 'evaluation.results.columns.query',
    })
    expect(within(fullQuery).getByText(longQuery)).toBeInTheDocument()

    await user.unhover(queryTrigger)
    await user.click(
      within(dialog).getByRole('button', {
        name: 'common.operation.viewDetails: Accuracy',
      }),
    )
    const metricDetails = await screen.findByRole('dialog', { name: 'Accuracy' })
    expect(within(metricDetails).getByText('Metric details with full context')).toBeInTheDocument()
  })
})
