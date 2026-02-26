import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PageSelector from './index'

const buildPage = (overrides: Partial<DataSourceNotionPage>): DataSourceNotionPage => ({
  page_id: 'page-id',
  page_name: 'Page name',
  parent_id: 'root',
  page_icon: null,
  type: 'page',
  is_bound: false,
  ...overrides,
})

const mockList: DataSourceNotionPage[] = [
  buildPage({ page_id: 'root-1', page_name: 'Root 1', parent_id: 'root' }),
  buildPage({ page_id: 'child-1', page_name: 'Child 1', parent_id: 'root-1' }),
  buildPage({ page_id: 'grandchild-1', page_name: 'Grandchild 1', parent_id: 'child-1' }),
]

const mockPagesMap: DataSourceNotionPageMap = {
  'root-1': { ...mockList[0], workspace_id: 'workspace-1' },
  'child-1': { ...mockList[1], workspace_id: 'workspace-1' },
  'grandchild-1': { ...mockList[2], workspace_id: 'workspace-1' },
}

describe('PageSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render root level pages initially', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    expect(screen.getByText('Root 1')).toBeInTheDocument()
    expect(screen.queryByText('Child 1')).not.toBeInTheDocument()
  })

  it('should expand child pages when toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    const toggle = screen.getByTestId('notion-page-toggle-root-1')
    await user.click(toggle)

    expect(screen.getByText('Child 1')).toBeInTheDocument()
  })

  it('should call onSelect with descendants when parent is selected', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-root-1')
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenCalledWith(new Set(['root-1', 'child-1', 'grandchild-1']))
  })

  it('should call onSelect with empty set when parent is deselected', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set(['root-1', 'child-1', 'grandchild-1'])} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-root-1')
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenCalledWith(new Set())
  })

  it('should show breadcrumbs when searching', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="Grandchild" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    expect(screen.getByText('Root 1 / Child 1 / Grandchild 1')).toBeInTheDocument()
  })

  it('should call onPreview when preview button is clicked', async () => {
    const handlePreview = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} onPreview={handlePreview} />)

    const previewBtn = screen.getByTestId('notion-page-preview-root-1')
    await user.click(previewBtn)

    expect(handlePreview).toHaveBeenCalledWith('root-1')
  })

  it('should show no result message when search returns nothing', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="nonexistent" pagesMap={mockPagesMap} list={[]} onSelect={vi.fn()} />)

    expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()
  })

  it('should handle selection when searchValue is present', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="Child" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-child-1')
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenCalledWith(new Set(['child-1']))
  })

  it('should handle preview when onPreview is not provided', async () => {
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    const previewBtn = screen.getByTestId('notion-page-preview-root-1')
    await user.click(previewBtn)
    // Should not crash
  })

  it('should handle toggle when item is already expanded', async () => {
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    const toggleBtn = screen.getByTestId('notion-page-toggle-root-1')
    await user.click(toggleBtn) // Expand
    await waitFor(() => expect(screen.queryByText('Child 1')).toBeInTheDocument())

    await user.click(toggleBtn) // Collapse
    await waitFor(() => expect(screen.queryByText('Child 1')).not.toBeInTheDocument())
  })
})
