import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PageSelector from '../index'

vi.mock('@tanstack/react-virtual')

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
  buildPage({ page_id: 'child-2', page_name: 'Child 2', parent_id: 'root-1' }),
  buildPage({ page_id: 'root-2', page_name: 'Root 2', parent_id: 'root' }),
]

const mockPagesMap: DataSourceNotionPageMap = {
  'root-1': { ...mockList[0]!, workspace_id: 'workspace-1' },
  'child-1': { ...mockList[1]!, workspace_id: 'workspace-1' },
  'grandchild-1': { ...mockList[2]!, workspace_id: 'workspace-1' },
  'child-2': { ...mockList[3]!, workspace_id: 'workspace-1' },
  'root-2': { ...mockList[4]!, workspace_id: 'workspace-1' },
}

describe('PageSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render root level pages initially', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    expect(screen.getByText('Root 1'))!.toBeInTheDocument()
    expect(screen.queryByText('Child 1')).not.toBeInTheDocument()
  })

  it('should expand child pages when toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    const toggle = screen.getByTestId('notion-page-toggle-root-1')
    await user.click(toggle)

    expect(screen.getByText('Child 1'))!.toBeInTheDocument()
  })

  it('should call onSelect with descendants when parent is selected', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={[mockList[0]!, mockList[1]!, mockList[2]!]} onSelect={handleSelect} />)

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

    expect(screen.getByText('Root 1 / Child 1 / Grandchild 1'))!.toBeInTheDocument()
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

    expect(screen.getByText('common.dataSource.notion.selector.noSearchResult'))!.toBeInTheDocument()
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
    await waitFor(() => expect(screen.queryByText('Child 1'))!.toBeInTheDocument())

    await user.click(toggleBtn) // Collapse
    await waitFor(() => expect(screen.queryByText('Child 1')).not.toBeInTheDocument())
  })

  it('should disable checkbox when page is in disabledValue', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set(['root-1'])} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-root-1')
    await user.click(checkbox)
    expect(handleSelect).not.toHaveBeenCalled()
  })

  it('should not render preview button when canPreview is false', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} canPreview={false} />)

    expect(screen.queryByTestId('notion-page-preview-root-1')).not.toBeInTheDocument()
  })

  it('should render preview button when canPreview is true', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} canPreview={true} />)

    expect(screen.getByTestId('notion-page-preview-root-1'))!.toBeInTheDocument()
  })

  it('should use previewPageId prop when provided', () => {
    const { rerender } = render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} previewPageId="root-1" />)

    let row = screen.getByTestId('notion-page-row-root-1')
    expect(row)!.toHaveClass('bg-state-base-hover')

    rerender(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} previewPageId="root-2" />)

    row = screen.getByTestId('notion-page-row-root-1')
    expect(row).not.toHaveClass('bg-state-base-hover')
  })

  it('should handle selection of multiple pages independently when searching', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="Child" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    const checkbox1 = screen.getByTestId('checkbox-notion-page-checkbox-child-1')
    const checkbox2 = screen.getByTestId('checkbox-notion-page-checkbox-child-2')

    await user.click(checkbox1)
    expect(handleSelect).toHaveBeenCalledWith(new Set(['child-1']))

    // Simulate parent component updating the value prop
    rerender(<PageSelector value={new Set(['child-1'])} disabledValue={new Set()} searchValue="Child" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    await user.click(checkbox2)
    expect(handleSelect).toHaveBeenLastCalledWith(new Set(['child-1', 'child-2']))
  })

  it('should expand and show all children when parent is selected', async () => {
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    const toggle = screen.getByTestId('notion-page-toggle-root-1')
    await user.click(toggle)

    // Both children should be visible
    // Both children should be visible
    expect(screen.getByText('Child 1'))!.toBeInTheDocument()
    expect(screen.getByText('Child 2'))!.toBeInTheDocument()
  })

  it('should expand nested children when toggling parent', async () => {
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    // Expand root-1
    let toggle = screen.getByTestId('notion-page-toggle-root-1')
    await user.click(toggle)
    expect(screen.getByText('Child 1'))!.toBeInTheDocument()

    // Expand child-1
    toggle = screen.getByTestId('notion-page-toggle-child-1')
    await user.click(toggle)
    expect(screen.getByText('Grandchild 1'))!.toBeInTheDocument()

    // Collapse child-1
    await user.click(toggle)
    await waitFor(() => expect(screen.queryByText('Grandchild 1')).not.toBeInTheDocument())
  })

  it('should deselect all descendants when parent is deselected with descendants', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set(['root-1', 'child-1', 'grandchild-1', 'child-2'])} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-root-1')
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenCalledWith(new Set())
  })

  it('should only select the item when searching (no descendants)', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="Child" pagesMap={mockPagesMap} list={[mockList[1]!]} onSelect={handleSelect} />)

    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-child-1')
    await user.click(checkbox)

    // When searching, only the item itself is selected, not descendants
    expect(handleSelect).toHaveBeenCalledWith(new Set(['child-1']))
  })

  it('should deselect only the item when searching (no descendants)', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set(['child-1'])} disabledValue={new Set()} searchValue="Child" pagesMap={mockPagesMap} list={[mockList[1]!]} onSelect={handleSelect} />)

    const checkbox = screen.getByTestId('checkbox-notion-page-checkbox-child-1')
    await user.click(checkbox)

    expect(handleSelect).toHaveBeenCalledWith(new Set())
  })

  it('should handle multiple root pages', async () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    expect(screen.getByText('Root 1'))!.toBeInTheDocument()
    expect(screen.getByText('Root 2'))!.toBeInTheDocument()
  })

  it('should update preview when clicking preview button with onPreview provided', async () => {
    const handlePreview = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} canPreview={true} onPreview={handlePreview} />)

    const previewBtn = screen.getByTestId('notion-page-preview-root-2')
    await user.click(previewBtn)

    expect(handlePreview).toHaveBeenCalledWith('root-2')
  })

  it('should update local preview state when preview button clicked', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} canPreview={true} />)

    const previewBtn1 = screen.getByTestId('notion-page-preview-root-1')
    await user.click(previewBtn1)

    // The preview should now show the hover state for root-1
    rerender(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} canPreview={true} />)

    const row = screen.getByTestId('notion-page-row-root-1')
    expect(row)!.toHaveClass('bg-state-base-hover')
  })

  it('should render page name with correct title attribute', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    const pageName = screen.getByTestId('notion-page-name-root-1')
    expect(pageName)!.toHaveAttribute('title', 'Root 1')
  })

  it('should handle empty list gracefully', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="" pagesMap={mockPagesMap} list={[]} onSelect={vi.fn()} />)

    expect(screen.getByText('common.dataSource.notion.selector.noSearchResult'))!.toBeInTheDocument()
  })

  it('should filter search results correctly with partial matches', () => {
    render(<PageSelector value={new Set()} disabledValue={new Set()} searchValue="1" pagesMap={mockPagesMap} list={mockList} onSelect={vi.fn()} />)

    // Should show Root 1, Child 1, and Grandchild 1
    // Should show Root 1, Child 1, and Grandchild 1
    expect(screen.getByTestId('notion-page-name-root-1'))!.toBeInTheDocument()
    expect(screen.getByTestId('notion-page-name-child-1'))!.toBeInTheDocument()
    expect(screen.getByTestId('notion-page-name-grandchild-1'))!.toBeInTheDocument()
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    // Should not show Root 2, Child 2
    expect(screen.queryByTestId('notion-page-name-root-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notion-page-name-child-2')).not.toBeInTheDocument()
  })

  it('should handle disabled parent when selecting child', async () => {
    const handleSelect = vi.fn()
    const user = userEvent.setup()
    render(<PageSelector value={new Set()} disabledValue={new Set(['root-1'])} searchValue="" pagesMap={mockPagesMap} list={mockList} onSelect={handleSelect} />)

    const toggle = screen.getByTestId('notion-page-toggle-root-1')
    await user.click(toggle)

    // Should expand even though parent is disabled
    // Should expand even though parent is disabled
    expect(screen.getByText('Child 1'))!.toBeInTheDocument()
  })
})
