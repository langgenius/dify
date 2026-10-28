import type { DatasetQueryDetailResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockFixtureImageFetch } from '@/test/image-fetch'
import Records from '../records'

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (ts: number, _fmt: string) => `time-${ts}`,
  }),
}))

const makeRecord = (
  id: string,
  source: DatasetQueryDetailResponse['source'],
  created_at: number,
  content = 'query text',
): DatasetQueryDetailResponse => ({
  id,
  source,
  created_at,
  created_by: 'user-1',
  created_by_role: 'account',
  source_app_id: null,
  queries: [{ content, content_type: 'text_query', file_info: null }],
})

describe('Records', () => {
  const mockOnClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call onClickRecord when row clicked', async () => {
    const user = userEvent.setup()
    const records = [makeRecord('1', 'app', 1000)]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    await user.click(screen.getByText('query text'))
    expect(mockOnClick).toHaveBeenCalledWith(records[0])
  })

  it('exposes the current sort order and toggles it from the keyboard', async () => {
    const user = userEvent.setup()
    const records = [makeRecord('1', 'app', 1000, 'early'), makeRecord('2', 'app', 3000, 'late')]
    render(<Records records={records} onClickRecord={mockOnClick} />)

    const header = screen.getByRole('columnheader', { name: 'datasetHitTesting.table.header.time' })
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('late')
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
    const records: DatasetQueryDetailResponse[] = [
      {
        id: '1',
        source: 'app',
        created_at: 1000,
        created_by: 'user-1',
        created_by_role: 'account',
        source_app_id: null,
        queries: [
          { content: '', content_type: 'text_query', file_info: null },
          {
            content: '',
            content_type: 'image_query',
            file_info: {
              id: 'img-1',
              name: 'img.png',
              mime_type: 'image/png',
              source_url:
                'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
              size: 100,
              extension: 'png',
            },
          },
        ],
      },
    ]
    render(<Records records={records} onClickRecord={mockOnClick} />)
    await user.click(screen.getByRole('button', { name: 'img.png' }))
    const preview = await screen.findByRole('dialog', { name: 'img.png' })
    expect(mockOnClick).not.toHaveBeenCalled()
    await user.click(within(preview).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'time-1000' }))
    expect(mockOnClick).toHaveBeenCalledExactlyOnceWith(records[0])
  })
})

beforeEach(() => mockFixtureImageFetch())
