import type { ComponentProps } from 'react'
import type { NotionPageRow } from '../types'
import { render, screen } from '@testing-library/react'
import VirtualPageList from '../virtual-page-list'

vi.mock('@tanstack/react-virtual')

const pageRowPropsSpy = vi.fn()
type MockPageRowProps = ComponentProps<typeof import('../page-row').default>

vi.mock('../page-row', () => ({
  default: ({
    checked,
    disabled,
    isPreviewed,
    onPreview,
    onSelect,
    onToggle,
    row,
    searchValue,
    selectionMode,
    showPreview,
    style,
  }: MockPageRowProps) => {
    pageRowPropsSpy({
      checked,
      disabled,
      isPreviewed,
      onPreview,
      onSelect,
      onToggle,
      row,
      searchValue,
      selectionMode,
      showPreview,
      style,
    })
    return <div data-testid={`page-row-${row.page.page_id}`} />
  },
}))

const buildRow = (overrides: Partial<NotionPageRow> = {}): NotionPageRow => ({
  page: {
    page_id: 'page-1',
    page_name: 'Page 1',
    parent_id: 'root',
    page_icon: null,
    type: 'page',
    is_bound: false,
  },
  parentExists: false,
  depth: 0,
  expand: false,
  hasChild: false,
  ancestors: [],
  ...overrides,
})

describe('VirtualPageList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render virtual rows and pass row state to PageRow', () => {
    const rows = [
      buildRow(),
      buildRow({
        page: {
          page_id: 'page-2',
          page_name: 'Page 2',
          parent_id: 'root',
          page_icon: null,
          type: 'page',
          is_bound: false,
        },
      }),
    ]

    render(
      <VirtualPageList
        checkedIds={new Set(['page-1'])}
        disabledValue={new Set(['page-2'])}
        onPreview={vi.fn()}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        previewPageId="page-2"
        rows={rows}
        searchValue=""
        selectionMode="multiple"
        showPreview
      />,
    )

    expect(screen.getByTestId('virtual-list')).toBeInTheDocument()
    expect(screen.getByTestId('page-row-page-1')).toBeInTheDocument()
    expect(screen.getByTestId('page-row-page-2')).toBeInTheDocument()
    expect(pageRowPropsSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      checked: true,
      disabled: false,
      isPreviewed: false,
      searchValue: '',
      selectionMode: 'multiple',
      showPreview: true,
      row: rows[0],
      style: expect.objectContaining({
        height: '28px',
        width: 'calc(100% - 16px)',
      }),
    }))
    expect(pageRowPropsSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      checked: false,
      disabled: true,
      isPreviewed: true,
      row: rows[1],
    }))
  })

  it('should size the virtual container using the row estimate', () => {
    const rows = [buildRow(), buildRow()]

    render(
      <VirtualPageList
        checkedIds={new Set<string>()}
        disabledValue={new Set<string>()}
        onPreview={vi.fn()}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        previewPageId=""
        rows={rows}
        searchValue=""
        selectionMode="multiple"
        showPreview={false}
      />,
    )

    const list = screen.getByTestId('virtual-list')
    const innerContainer = list.firstElementChild as HTMLElement

    expect(innerContainer).toHaveStyle({
      height: '56px',
      position: 'relative',
    })
  })
})
