import type { ComponentProps } from 'react'
import type { NotionPageRow } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PageRow from '../page-row'

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

const renderPageRow = (overrides: Partial<ComponentProps<typeof PageRow>> = {}) => {
  const props: ComponentProps<typeof PageRow> = {
    checked: false,
    disabled: false,
    isPreviewed: false,
    onPreview: vi.fn(),
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    row: buildRow(),
    searchValue: '',
    selectionMode: 'multiple',
    showPreview: true,
    style: { height: 28 },
    ...overrides,
  }

  return {
    ...render(<PageRow {...props} />),
    props,
  }
}

describe('PageRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call onSelect with the page id when the checkbox is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderPageRow({ onSelect })

    await user.click(screen.getByTestId('checkbox-notion-page-checkbox-page-1'))

    expect(onSelect).toHaveBeenCalledWith('page-1')
  })

  it('should call onToggle when the row has children and the toggle is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    renderPageRow({
      onToggle,
      row: buildRow({
        hasChild: true,
        expand: true,
      }),
    })

    await user.click(screen.getByTestId('notion-page-toggle-page-1'))

    expect(onToggle).toHaveBeenCalledWith('page-1')
  })

  it('should render breadcrumbs and hide the toggle while searching', () => {
    renderPageRow({
      searchValue: 'Page',
      row: buildRow({
        parentExists: true,
        ancestors: ['Workspace', 'Section'],
      }),
    })

    expect(screen.queryByTestId('notion-page-toggle-page-1')).not.toBeInTheDocument()
    expect(screen.getByText('Workspace / Section / Page 1')).toBeInTheDocument()
  })

  it('should render preview state and call onPreview when the preview button is clicked', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()

    renderPageRow({
      isPreviewed: true,
      onPreview,
    })

    expect(screen.getByTestId('notion-page-row-page-1')).toHaveClass('bg-state-base-hover')

    await user.click(screen.getByTestId('notion-page-preview-page-1'))

    expect(onPreview).toHaveBeenCalledWith('page-1')
  })

  it('should hide the preview button when showPreview is false', () => {
    renderPageRow({ showPreview: false })

    expect(screen.queryByTestId('notion-page-preview-page-1')).not.toBeInTheDocument()
  })
})
