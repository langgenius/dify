import { render, screen } from '@testing-library/react'
import SummaryStatus from '../summary-status'

it('shows the summary-generation badge only while summarizing', () => {
  const { rerender } = render(<SummaryStatus status="SUMMARIZING" />)
  expect(screen.getByText('datasetDocuments.list.summary.generating')).toBeInTheDocument()
  rerender(<SummaryStatus status="COMPLETED" />)
  expect(screen.queryByText('datasetDocuments.list.summary.generating')).not.toBeInTheDocument()
})
