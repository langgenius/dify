import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SummaryStatus from '../summary-status'

vi.mock('@/app/components/base/badge', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}))

describe('SummaryStatus', () => {
  it('should render badge for SUMMARIZING status', () => {
    render(<SummaryStatus status="SUMMARIZING" />)
    expect(screen.getByTestId('badge')).toBeInTheDocument()
    expect(screen.getByText('datasetDocuments.list.summary.generating')).toBeInTheDocument()
  })

  it('should not render badge for other statuses', () => {
    render(<SummaryStatus status="COMPLETED" />)
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument()
  })
})
