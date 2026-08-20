import type { HitTestingRecord } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Records from '../records'

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (ts: number, _fmt: string) => `time-${ts}`,
  }),
}))

vi.mock('../../../common/image-list', () => ({
  default: () => <div data-testid="image-list" />,
}))

const makeRecord = (id: string, source: string, created_at: number, content = 'query text') =>
  ({
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
    expect(
      screen.getByRole('columnheader', { name: 'datasetHitTesting.table.header.queryContent' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'datasetHitTesting.table.header.source' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'datasetHitTesting.table.header.time' }),
    ).toBeInTheDocument()
  })

  it('should render records', () => {
    const records = [makeRecord('1', 'app', 1000), makeRecord('2', 'hit_testing', 2000)]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    expect(screen.getAllByText('query text')).toHaveLength(2)
  })

  it('should call onClickRecord when row clicked', async () => {
    const user = userEvent.setup()
    const records = [makeRecord('1', 'app', 1000)]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    await user.click(screen.getByText('query text'))
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

  it('exposes the current sort order and toggles it from the keyboard', async () => {
    const user = userEvent.setup()
    const records = [makeRecord('1', 'app', 1000, 'early'), makeRecord('2', 'app', 3000, 'late')]
    render(<Records records={records} onClickRecord={mockOnClick} />)

    const header = screen.getByRole('columnheader', { name: 'datasetHitTesting.table.header.time' })
    expect(header).toHaveAttribute('aria-sort', 'descending')
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'datasetHitTesting.table.header.time' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('early')
    await user.keyboard(' ')
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('late')
  })

  it('reuses a record once through its keyboard-accessible time button', async () => {
    const user = userEvent.setup()
    const record = makeRecord('1', 'app', 1000)
    render(<Records records={[record]} onClickRecord={mockOnClick} />)

    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'time-1000' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(mockOnClick).toHaveBeenCalledExactlyOnceWith(record)
  })

  it('provides a reuse button for image-only queries', async () => {
    const user = userEvent.setup()
    const records = [
      {
        id: '1',
        source: 'app',
        created_at: 1000,
        queries: [
          { content: '', content_type: 'text_query', file_info: null },
          {
            content: '',
            content_type: 'image_query',
            file_info: {
              name: 'img.png',
              mime_type: 'image/png',
              source_url: 'url',
              size: 100,
              extension: 'png',
            },
          },
        ],
      },
    ] as unknown as HitTestingRecord[]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    expect(screen.getByTestId('image-list')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'time-1000' }))
    expect(mockOnClick).toHaveBeenCalledExactlyOnceWith(records[0])
  })
})
