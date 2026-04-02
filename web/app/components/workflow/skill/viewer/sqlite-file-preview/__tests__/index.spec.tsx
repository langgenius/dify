import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import SQLiteFilePreview from '../index'

const mocks = vi.hoisted(() => ({
  databaseState: {
    tables: [] as string[],
    isLoading: false,
    error: null as Error | null,
    queryTable: vi.fn(),
  },
  tableState: {
    data: null as null | { columns: string[], values: unknown[][] },
    isLoading: false,
    error: null as Error | null,
  },
  selectorProps: [] as Array<Record<string, unknown>>,
  panelProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../../hooks/use-sqlite-database', () => ({
  useSQLiteDatabase: () => mocks.databaseState,
}))

vi.mock('../use-sqlite-table', () => ({
  useSQLiteTable: (args: unknown) => {
    mocks.selectorProps.push({ hookArgs: args })
    return mocks.tableState
  },
}))

vi.mock('../table-selector', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.selectorProps.push(props)
    return (
      <button type="button" onClick={() => (props.onTableChange as (value: string) => void)('events')}>
        change-table
      </button>
    )
  },
}))

vi.mock('../table-panel', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.panelProps.push(props)
    return <div data-testid="sqlite-table-panel" />
  },
}))

describe('SQLiteFilePreview', () => {
  const getHookInvocations = () => {
    return mocks.selectorProps.filter(item => Object.hasOwn(item, 'hookArgs'))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectorProps.length = 0
    mocks.panelProps.length = 0
    mocks.databaseState = {
      tables: [],
      isLoading: false,
      error: null,
      queryTable: vi.fn(),
    }
    mocks.tableState = {
      data: null,
      isLoading: false,
      error: null,
    }
  })

  it('should render the unavailable state when no url is provided', () => {
    render(<SQLiteFilePreview downloadUrl="" />)

    expect(screen.getByText('workflow.skillEditor.previewUnavailable')).toBeInTheDocument()
  })

  it('should render the loading state from the database hook', () => {
    mocks.databaseState.isLoading = true
    render(<SQLiteFilePreview downloadUrl="https://example.com/demo.db?state=loading" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render the error state from the database hook', () => {
    mocks.databaseState.error = new Error('boom')

    render(<SQLiteFilePreview downloadUrl="https://example.com/demo.db?state=error" />)

    expect(screen.getByText('workflow.skillSidebar.sqlitePreview.loadError')).toBeInTheDocument()
  })

  it('should render the empty state when the database has no tables', () => {
    render(<SQLiteFilePreview downloadUrl="https://example.com/demo.db?state=empty" />)

    expect(screen.getByText('workflow.skillSidebar.sqlitePreview.emptyTables')).toBeInTheDocument()
  })

  it('should render selector and panel props when tables are available', () => {
    mocks.databaseState.tables = ['users', 'events']
    mocks.tableState.data = {
      columns: ['id'],
      values: Array.from({ length: 1000 }, (_, index) => [index + 1]),
    }

    render(<SQLiteFilePreview downloadUrl="https://example.com/demo.db" />)

    expect(screen.getByTestId('sqlite-table-panel')).toBeInTheDocument()
    expect(mocks.selectorProps.find(item => Object.hasOwn(item, 'tables'))).toMatchObject({
      tables: ['users', 'events'],
      selectedTable: 'users',
      isLoading: false,
    })
    expect(mocks.panelProps[0]).toMatchObject({
      data: mocks.tableState.data,
      isLoading: false,
      error: null,
      isTruncated: true,
    })
  })

  it('should update the selected table when the selector changes', () => {
    mocks.databaseState.tables = ['users', 'events']

    render(<SQLiteFilePreview downloadUrl="https://example.com/demo.db" />)

    fireEvent.click(screen.getByRole('button', { name: 'change-table' }))

    return waitFor(() => {
      expect(getHookInvocations().at(-1)).toMatchObject({
        hookArgs: {
          selectedTable: 'events',
          queryTable: mocks.databaseState.queryTable,
        },
      })
    })
  })
})
