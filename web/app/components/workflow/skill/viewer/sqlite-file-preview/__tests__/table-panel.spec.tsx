import type { RefObject } from 'react'
import { render, screen } from '@testing-library/react'
import TablePanel from '../table-panel'

const mocks = vi.hoisted(() => ({
  dataTableProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('../data-table', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.dataTableProps.push(props)
    return <div data-testid="sqlite-data-table" />
  },
}))
const createScrollRef = () => ({ current: null }) as RefObject<HTMLDivElement | null>

describe('TablePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dataTableProps.length = 0
  })

  it('should render a loading state', () => {
    render(
      <TablePanel
        data={null}
        isLoading
        error={null}
        scrollRef={createScrollRef()}
      />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render an error state', () => {
    render(
      <TablePanel
        data={null}
        isLoading={false}
        error={new Error('boom')}
        scrollRef={createScrollRef()}
      />,
    )

    expect(screen.getByText('workflow.skillSidebar.sqlitePreview.loadError')).toBeInTheDocument()
  })

  it('should render the data table when rows are available', () => {
    const scrollRef = createScrollRef()
    const data = {
      columns: ['id'],
      values: [[1]],
    }

    render(
      <TablePanel
        data={data}
        isLoading={false}
        error={null}
        scrollRef={scrollRef}
        isTruncated
      />,
    )

    expect(screen.getByTestId('sqlite-data-table')).toBeInTheDocument()
    expect(mocks.dataTableProps[0]).toMatchObject({
      columns: ['id'],
      values: [[1]],
      scrollRef,
      isTruncated: true,
    })
  })

  it('should render an empty state when no rows are available', () => {
    render(
      <TablePanel
        data={null}
        isLoading={false}
        error={null}
        scrollRef={createScrollRef()}
      />,
    )

    expect(screen.getByText('workflow.skillSidebar.sqlitePreview.emptyRows')).toBeInTheDocument()
  })
})
