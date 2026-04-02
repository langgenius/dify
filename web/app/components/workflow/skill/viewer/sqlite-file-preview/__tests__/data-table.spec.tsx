import type { RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import DataTable from '../data-table'

const mocks = vi.hoisted(() => ({
  lastOptions: null as null | {
    getScrollElement: () => HTMLDivElement | null
    estimateSize: () => number
  },
  virtualRows: [
    { index: 0, start: 10, end: 42 },
    { index: 1, start: 42, end: 74 },
  ],
  totalSize: 100,
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: typeof mocks.lastOptions) => {
    mocks.lastOptions = options
    options?.getScrollElement()
    options?.estimateSize()
    return {
      getVirtualItems: () => mocks.virtualRows,
      getTotalSize: () => mocks.totalSize,
    }
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}${options ? `:${JSON.stringify(options)}` : ''}`,
  }),
}))
const createScrollRef = () => ({ current: null }) as RefObject<HTMLDivElement | null>

describe('DataTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lastOptions = null
    mocks.virtualRows = [
      { index: 0, start: 10, end: 42 },
      { index: 1, start: 42, end: 74 },
    ]
    mocks.totalSize = 100
  })

  it('should render virtualized rows, formatted values, and truncation footer', () => {
    const longText = 'x'.repeat(130)

    const { container } = render(
      <DataTable
        columns={['id', 'empty', 'blob', 'big', 'description']}
        values={[
          [1, null, new Uint8Array([1, 2]), 3n, longText],
          [2, 'value', new Uint8Array([3]), 4n, 'short'],
        ]}
        scrollRef={createScrollRef()}
        isTruncated
      />,
    )

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('skillSidebar.sqlitePreview.nullValue')).toBeInTheDocument()
    expect(screen.getByText('skillSidebar.sqlitePreview.blobValue:{"size":2}')).toBeInTheDocument()
    expect(screen.getByText(`${'x'.repeat(120)}…`)).toBeInTheDocument()
    expect(screen.getByText('skillSidebar.sqlitePreview.rowsTruncated:{"limit":2}')).toBeInTheDocument()
    expect(container.querySelectorAll('tr[aria-hidden="true"]')).toHaveLength(2)
    expect(mocks.lastOptions?.estimateSize()).toBe(32)
    expect(mocks.lastOptions?.getScrollElement()).toBeNull()
  })

  it('should fall back to the row index as a key when no key column exists', () => {
    render(
      <DataTable
        columns={['name']}
        values={[['Ada'], ['Grace']]}
        scrollRef={createScrollRef()}
      />,
    )

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Grace')).toBeInTheDocument()
  })

  it('should fall back to the virtual row index when the key column value is null', () => {
    mocks.virtualRows = [{ index: 0, start: 0, end: 32 }]
    mocks.totalSize = 32

    render(
      <DataTable
        columns={['id', 'name']}
        values={[[null, 'Ada']]}
        scrollRef={createScrollRef()}
      />,
    )

    expect(screen.getByText('Ada')).toBeInTheDocument()
  })

  it('should skip spacer rows when the virtualizer has no visible rows', () => {
    mocks.virtualRows = []
    mocks.totalSize = 0

    const { container } = render(
      <DataTable
        columns={['name']}
        values={[]}
        scrollRef={createScrollRef()}
      />,
    )

    expect(container.querySelectorAll('tr[aria-hidden="true"]')).toHaveLength(0)
    expect(screen.getByText('name')).toBeInTheDocument()
  })
})
