import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DataSourceType } from '@/models/datasets'
import IndexingProgressItem from '../indexing-progress-item'

// Billing labels have their own tests and are outside indexing progress semantics.
vi.mock('@/app/components/billing/priority-label', () => ({
  default: () => <span data-testid="priority-label">Priority</span>,
}))
describe('IndexingProgressItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeDetail = (overrides: Partial<DocumentStatusResponse> = {}): DocumentStatusResponse => ({
    id: 'doc-1',
    indexing_status: 'indexing',
    processing_started_at: 0,
    parsing_completed_at: 0,
    cleaning_completed_at: 0,
    splitting_completed_at: 0,
    completed_at: null,
    paused_at: null,
    error: null,
    stopped_at: null,
    completed_segments: 50,
    total_segments: 100,
    ...overrides,
  })

  it('should render name and progress for embedding status', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail()}
        name="test.pdf"
        sourceType={DataSourceType.FILE}
      />,
    )

    expect(screen.getByText('test.pdf')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'test.pdf' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
  })

  it('announces a file completing after processing without retaining its progress bar', () => {
    const { rerender } = render(<IndexingProgressItem detail={makeDetail()} name="done.pdf" />)
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()
    expect(screen.getByRole('progressbar', { name: 'done.pdf' })).toBeInTheDocument()

    rerender(
      <IndexingProgressItem
        detail={makeDetail({ indexing_status: 'completed' })}
        name="done.pdf"
      />,
    )

    expect(status).toHaveTextContent('done.pdf: datasetDocuments.embedding.completed')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('opens the full indexing error from the warning button', async () => {
    const user = userEvent.setup()
    render(
      <IndexingProgressItem
        detail={makeDetail({ indexing_status: 'error', error: 'Parse failed' })}
        name="broken.pdf"
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('broken.pdf: common.error: Parse failed')
    await user.click(screen.getByRole('button', { name: 'common.error' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Parse failed')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'common.error' })).toHaveFocus()
  })

  it('should use the localized fallback when an error has no message', async () => {
    const user = userEvent.setup()
    render(
      <IndexingProgressItem
        detail={makeDetail({ indexing_status: 'error', error: null })}
        name="broken.pdf"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.error' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('common.error')
  })
})
