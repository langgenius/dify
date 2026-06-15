import type { HitTestingRecord } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Records from '../records'

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (ts: number, _fmt: string) => `time-${ts}`,
  }),
}))

vi.mock('../../../common/image-list', () => ({
  default: () => <div data-testid="image-list" />,
}))

const makeRecord = (id: string, source: string, created_at: number, content = 'query text') => ({
  id,
  source,
  created_at,
  queries: [{ content, content_type: 'text_query', file_info: null }],
}) as unknown as HitTestingRecord

describe('Records', () => {
  const mockOnClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render table headers', () => {
    render(<Records records={[]} onClickRecord={mockOnClick} />)
    expect(screen.getByText('datasetHitTesting.table.header.queryContent')).toBeInTheDocument()
    expect(screen.getByText('datasetHitTesting.table.header.source')).toBeInTheDocument()
    expect(screen.getByText('datasetHitTesting.table.header.time')).toBeInTheDocument()
  })

  it('should render records', () => {
    const records = [
      makeRecord('1', 'app', 1000),
      makeRecord('2', 'hit_testing', 2000),
    ]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    expect(screen.getAllByText('query text')).toHaveLength(2)
  })

  it('should call onClickRecord when row clicked', () => {
    const records = [makeRecord('1', 'app', 1000)]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    fireEvent.click(screen.getByText('query text'))
    expect(mockOnClick).toHaveBeenCalledWith(records[0])
  })

  it('should sort records by time descending by default', () => {
    const records = [
      makeRecord('1', 'app', 1000, 'early'),
      makeRecord('2', 'app', 3000, 'late'),
      makeRecord('3', 'app', 2000, 'mid'),
    ]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    const rows = screen.getAllByRole('row').slice(1) // skip header
    expect(rows[0]).toHaveTextContent('late')
    expect(rows[1]).toHaveTextContent('mid')
    expect(rows[2]).toHaveTextContent('early')
  })

  it('should toggle sort order on time header click', () => {
    const records = [
      makeRecord('1', 'app', 1000, 'early'),
      makeRecord('2', 'app', 3000, 'late'),
    ]
    render(<Records records={records} onClickRecord={mockOnClick} />)

    // Default: desc, so late first
    let rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('late')

    fireEvent.click(screen.getByText('datasetHitTesting.table.header.time'))
    rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('early')
  })

  it('should render image list for image queries', () => {
    const records = [{
      id: '1',
      source: 'app',
      created_at: 1000,
      queries: [
        { content: '', content_type: 'text_query', file_info: null },
        { content: '', content_type: 'image_query', file_info: { name: 'img.png', mime_type: 'image/png', source_url: 'url', size: 100, extension: 'png' } },
      ],
    }] as unknown as HitTestingRecord[]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    expect(screen.getByTestId('image-list')).toBeInTheDocument()
  })
})
