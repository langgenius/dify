import type { NotionPageTreeItem, NotionPageTreeMap } from '../index'
import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import PageSelector from '../index'
import { recursivePushInParentDescendants } from '../utils'

// Mock react-window FixedSizeList - renders items directly for testing
vi.mock('react-window', () => ({
  FixedSizeList: ({ children: ItemComponent, itemCount, itemData, itemKey }: { children: React.ComponentType<{ index: number, style: React.CSSProperties, data: unknown }>, itemCount: number, itemData: unknown, itemKey?: (index: number, data: unknown) => string | number }) => (
    <div data-testid="virtual-list">
      {Array.from({ length: itemCount }).map((_, index) => (
        <ItemComponent
          key={itemKey?.(index, itemData) || index}
          index={index}
          style={{ top: index * 28, left: 0, right: 0, width: '100%', position: 'absolute' as const }}
          data={itemData}
        />
      ))}
    </div>
  ),
  areEqual: (prevProps: Record<string, unknown>, nextProps: Record<string, unknown>) => prevProps === nextProps,
}))

// Note: NotionIcon from @/app/components/base/ is NOT mocked - using real component per testing guidelines

// Helper Functions for Base Components
// Get checkbox element (uses data-testid pattern from base Checkbox component)
const getCheckbox = () => document.querySelector('[data-testid^="checkbox-"]') as HTMLElement
const getAllCheckboxes = () => document.querySelectorAll('[data-testid^="checkbox-"]')

// Get radio element (uses size-4 rounded-full class pattern from base Radio component)
const getRadio = () => document.querySelector('.size-4.rounded-full') as HTMLElement
const getAllRadios = () => document.querySelectorAll('.size-4.rounded-full')

// Check if checkbox is checked by looking for check icon
const isCheckboxChecked = (checkbox: Element) => checkbox.querySelector('[data-testid^="check-icon-"]') !== null

// Check if checkbox is disabled by looking for disabled class
const isCheckboxDisabled = (checkbox: Element) => checkbox.classList.contains('cursor-not-allowed')

const createMockPage = (overrides?: Partial<DataSourceNotionPage>): DataSourceNotionPage => ({
  page_id: 'page-1',
  page_name: 'Test Page',
  page_icon: null,
  is_bound: false,
  parent_id: 'root',
  type: 'page',
  ...overrides,
})

const createMockPagesMap = (pages: DataSourceNotionPage[]): DataSourceNotionPageMap => {
  return pages.reduce((acc, page) => {
    acc[page.page_id] = { ...page, workspace_id: 'workspace-1' }
    return acc
  }, {} as DataSourceNotionPageMap)
}

type PageSelectorProps = React.ComponentProps<typeof PageSelector>

const createDefaultProps = (overrides?: Partial<PageSelectorProps>): PageSelectorProps => {
  const defaultList = [createMockPage()]
  return {
    checkedIds: new Set<string>(),
    disabledValue: new Set<string>(),
    searchValue: '',
    pagesMap: createMockPagesMap(defaultList),
    list: defaultList,
    onSelect: vi.fn(),
    canPreview: true,
    onPreview: vi.fn(),
    isMultipleChoice: true,
    currentCredentialId: 'cred-1',
    ...overrides,
  }
}

// Helper to create hierarchical page structure
const createHierarchicalPages = () => {
  const rootPage = createMockPage({ page_id: 'root-page', page_name: 'Root Page', parent_id: 'root' })
  const childPage1 = createMockPage({ page_id: 'child-1', page_name: 'Child 1', parent_id: 'root-page' })
  const childPage2 = createMockPage({ page_id: 'child-2', page_name: 'Child 2', parent_id: 'root-page' })
  const grandChild = createMockPage({ page_id: 'grandchild-1', page_name: 'Grandchild 1', parent_id: 'child-1' })

  const list = [rootPage, childPage1, childPage2, grandChild]
  const pagesMap = createMockPagesMap(list)

  return { list, pagesMap, rootPage, childPage1, childPage2, grandChild }
}

describe('PageSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const props = createDefaultProps()

      render(<PageSelector {...props} />)

      expect(screen.getByTestId('virtual-list')).toBeInTheDocument()
    })

    it('should render empty state when list is empty', () => {
      const props = createDefaultProps({
        list: [],
        pagesMap: {},
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()
      expect(screen.queryByTestId('virtual-list')).not.toBeInTheDocument()
    })

    it('should render items using FixedSizeList', () => {
      const pages = [
        createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
        createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
      ]
      const props = createDefaultProps({
        list: pages,
        pagesMap: createMockPagesMap(pages),
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText('Page 1')).toBeInTheDocument()
      expect(screen.getByText('Page 2')).toBeInTheDocument()
    })

    it('should render checkboxes when isMultipleChoice is true', () => {
      const props = createDefaultProps({ isMultipleChoice: true })

      render(<PageSelector {...props} />)

      expect(getCheckbox()).toBeInTheDocument()
    })

    it('should render radio buttons when isMultipleChoice is false', () => {
      const props = createDefaultProps({ isMultipleChoice: false })

      render(<PageSelector {...props} />)

      expect(getRadio()).toBeInTheDocument()
    })

    it('should render preview button when canPreview is true', () => {
      const props = createDefaultProps({ canPreview: true })

      render(<PageSelector {...props} />)

      expect(screen.getByText('common.dataSource.notion.selector.preview')).toBeInTheDocument()
    })

    it('should not render preview button when canPreview is false', () => {
      const props = createDefaultProps({ canPreview: false })

      render(<PageSelector {...props} />)

      expect(screen.queryByText('common.dataSource.notion.selector.preview')).not.toBeInTheDocument()
    })

    it('should render NotionIcon for each page', () => {
      const props = createDefaultProps()

      render(<PageSelector {...props} />)

      // Assert - NotionIcon renders svg when page_icon is null
      const notionIcon = document.querySelector('.h-5.w-5')
      expect(notionIcon).toBeInTheDocument()
    })

    it('should render page name', () => {
      const props = createDefaultProps({
        list: [createMockPage({ page_name: 'My Custom Page' })],
        pagesMap: createMockPagesMap([createMockPage({ page_name: 'My Custom Page' })]),
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText('My Custom Page')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('checkedIds prop', () => {
      it('should mark checkbox as checked when page is in checkedIds', () => {
        const page = createMockPage({ page_id: 'page-1' })
        const props = createDefaultProps({
          list: [page],
          pagesMap: createMockPagesMap([page]),
          checkedIds: new Set(['page-1']),
        })

        render(<PageSelector {...props} />)

        const checkbox = getCheckbox()
        expect(checkbox).toBeInTheDocument()
        expect(isCheckboxChecked(checkbox)).toBe(true)
      })

      it('should mark checkbox as unchecked when page is not in checkedIds', () => {
        const page = createMockPage({ page_id: 'page-1' })
        const props = createDefaultProps({
          list: [page],
          pagesMap: createMockPagesMap([page]),
          checkedIds: new Set(),
        })

        render(<PageSelector {...props} />)

        const checkbox = getCheckbox()
        expect(checkbox).toBeInTheDocument()
        expect(isCheckboxChecked(checkbox)).toBe(false)
      })

      it('should handle empty checkedIds', () => {
        const props = createDefaultProps({ checkedIds: new Set() })

        render(<PageSelector {...props} />)

        const checkbox = getCheckbox()
        expect(checkbox).toBeInTheDocument()
        expect(isCheckboxChecked(checkbox)).toBe(false)
      })

      it('should handle multiple checked items', () => {
        const pages = [
          createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
          createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
          createMockPage({ page_id: 'page-3', page_name: 'Page 3' }),
        ]
        const props = createDefaultProps({
          list: pages,
          pagesMap: createMockPagesMap(pages),
          checkedIds: new Set(['page-1', 'page-3']),
        })

        render(<PageSelector {...props} />)

        const checkboxes = getAllCheckboxes()
        expect(isCheckboxChecked(checkboxes[0])).toBe(true)
        expect(isCheckboxChecked(checkboxes[1])).toBe(false)
        expect(isCheckboxChecked(checkboxes[2])).toBe(true)
      })
    })

    describe('disabledValue prop', () => {
      it('should disable checkbox when page is in disabledValue', () => {
        const page = createMockPage({ page_id: 'page-1' })
        const props = createDefaultProps({
          list: [page],
          pagesMap: createMockPagesMap([page]),
          disabledValue: new Set(['page-1']),
        })

        render(<PageSelector {...props} />)

        const checkbox = getCheckbox()
        expect(checkbox).toBeInTheDocument()
        expect(isCheckboxDisabled(checkbox)).toBe(true)
      })

      it('should not disable checkbox when page is not in disabledValue', () => {
        const page = createMockPage({ page_id: 'page-1' })
        const props = createDefaultProps({
          list: [page],
          pagesMap: createMockPagesMap([page]),
          disabledValue: new Set(),
        })

        render(<PageSelector {...props} />)

        const checkbox = getCheckbox()
        expect(checkbox).toBeInTheDocument()
        expect(isCheckboxDisabled(checkbox)).toBe(false)
      })

      it('should handle partial disabled items', () => {
        const pages = [
          createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
          createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
        ]
        const props = createDefaultProps({
          list: pages,
          pagesMap: createMockPagesMap(pages),
          disabledValue: new Set(['page-1']),
        })

        render(<PageSelector {...props} />)

        const checkboxes = getAllCheckboxes()
        expect(isCheckboxDisabled(checkboxes[0])).toBe(true)
        expect(isCheckboxDisabled(checkboxes[1])).toBe(false)
      })
    })

    describe('searchValue prop', () => {
      it('should filter pages by search value', () => {
        const pages = [
          createMockPage({ page_id: 'page-1', page_name: 'Apple Page' }),
          createMockPage({ page_id: 'page-2', page_name: 'Banana Page' }),
          createMockPage({ page_id: 'page-3', page_name: 'Apple Pie' }),
        ]
        const props = createDefaultProps({
          list: pages,
          pagesMap: createMockPagesMap(pages),
          searchValue: 'Apple',
        })

        render(<PageSelector {...props} />)

        // Assert - Only pages containing "Apple" should be visible
        // Use getAllByText since the page name appears in both title div and breadcrumbs
        expect(screen.getAllByText('Apple Page').length).toBeGreaterThan(0)
        expect(screen.getAllByText('Apple Pie').length).toBeGreaterThan(0)
        // Banana Page is filtered out because it doesn't contain "Apple"
        expect(screen.queryByText('Banana Page')).not.toBeInTheDocument()
      })

      it('should show empty state when no pages match search', () => {
        const pages = [createMockPage({ page_id: 'page-1', page_name: 'Test Page' })]
        const props = createDefaultProps({
          list: pages,
          pagesMap: createMockPagesMap(pages),
          searchValue: 'NonExistent',
        })

        render(<PageSelector {...props} />)

        expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()
      })

      it('should show all pages when searchValue is empty', () => {
        const pages = [
          createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
          createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
        ]
        const props = createDefaultProps({
          list: pages,
          pagesMap: createMockPagesMap(pages),
          searchValue: '',
        })

        render(<PageSelector {...props} />)

        expect(screen.getByText('Page 1')).toBeInTheDocument()
        expect(screen.getByText('Page 2')).toBeInTheDocument()
      })

      it('should show breadcrumbs when searchValue is present', () => {
        const { list, pagesMap } = createHierarchicalPages()
        const props = createDefaultProps({
          list,
          pagesMap,
          searchValue: 'Grandchild',
        })

        render(<PageSelector {...props} />)

        // Assert - page name should be visible
        expect(screen.getByText('Grandchild 1')).toBeInTheDocument()
      })

      it('should perform case-sensitive search', () => {
        const pages = [
          createMockPage({ page_id: 'page-1', page_name: 'Apple Page' }),
          createMockPage({ page_id: 'page-2', page_name: 'apple page' }),
        ]
        const props = createDefaultProps({
          list: pages,
          pagesMap: createMockPagesMap(pages),
          searchValue: 'Apple',
        })

        render(<PageSelector {...props} />)

        // Assert - Only 'Apple Page' should match (case-sensitive)
        // Use getAllByText since the page name appears in both title div and breadcrumbs
        expect(screen.getAllByText('Apple Page').length).toBeGreaterThan(0)
        expect(screen.queryByText('apple page')).not.toBeInTheDocument()
      })
    })

    describe('canPreview prop', () => {
      it('should show preview button when canPreview is true', () => {
        const props = createDefaultProps({ canPreview: true })

        render(<PageSelector {...props} />)

        expect(screen.getByText('common.dataSource.notion.selector.preview')).toBeInTheDocument()
      })

      it('should hide preview button when canPreview is false', () => {
        const props = createDefaultProps({ canPreview: false })

        render(<PageSelector {...props} />)

        expect(screen.queryByText('common.dataSource.notion.selector.preview')).not.toBeInTheDocument()
      })

      it('should use default value true when canPreview is not provided', () => {
        const props = createDefaultProps()
        delete (props as Partial<PageSelectorProps>).canPreview

        render(<PageSelector {...props} />)

        expect(screen.getByText('common.dataSource.notion.selector.preview')).toBeInTheDocument()
      })
    })

    describe('isMultipleChoice prop', () => {
      it('should render checkbox when isMultipleChoice is true', () => {
        const props = createDefaultProps({ isMultipleChoice: true })

        render(<PageSelector {...props} />)

        expect(getCheckbox()).toBeInTheDocument()
        expect(getRadio()).not.toBeInTheDocument()
      })

      it('should render radio when isMultipleChoice is false', () => {
        const props = createDefaultProps({ isMultipleChoice: false })

        render(<PageSelector {...props} />)

        expect(getRadio()).toBeInTheDocument()
        expect(getCheckbox()).not.toBeInTheDocument()
      })

      it('should use default value true when isMultipleChoice is not provided', () => {
        const props = createDefaultProps()
        delete (props as Partial<PageSelectorProps>).isMultipleChoice

        render(<PageSelector {...props} />)

        expect(getCheckbox()).toBeInTheDocument()
      })
    })

    describe('onSelect prop', () => {
      it('should call onSelect when checkbox is clicked', () => {
        const mockOnSelect = vi.fn()
        const props = createDefaultProps({ onSelect: mockOnSelect })

        render(<PageSelector {...props} />)
        fireEvent.click(getCheckbox())

        expect(mockOnSelect).toHaveBeenCalledTimes(1)
        expect(mockOnSelect).toHaveBeenCalledWith(expect.any(Set))
      })

      it('should pass updated set to onSelect', () => {
        const mockOnSelect = vi.fn()
        const page = createMockPage({ page_id: 'page-1' })
        const props = createDefaultProps({
          list: [page],
          pagesMap: createMockPagesMap([page]),
          checkedIds: new Set(),
          onSelect: mockOnSelect,
        })

        render(<PageSelector {...props} />)
        fireEvent.click(getCheckbox())

        const calledSet = mockOnSelect.mock.calls[0][0] as Set<string>
        expect(calledSet.has('page-1')).toBe(true)
      })
    })

    describe('onPreview prop', () => {
      it('should call onPreview when preview button is clicked', () => {
        const mockOnPreview = vi.fn()
        const page = createMockPage({ page_id: 'page-1' })
        const props = createDefaultProps({
          list: [page],
          pagesMap: createMockPagesMap([page]),
          onPreview: mockOnPreview,
          canPreview: true,
        })

        render(<PageSelector {...props} />)
        fireEvent.click(screen.getByText('common.dataSource.notion.selector.preview'))

        expect(mockOnPreview).toHaveBeenCalledWith('page-1')
      })

      it('should not throw when onPreview is undefined', () => {
        const props = createDefaultProps({
          onPreview: undefined,
          canPreview: true,
        })

        expect(() => {
          render(<PageSelector {...props} />)
          fireEvent.click(screen.getByText('common.dataSource.notion.selector.preview'))
        }).not.toThrow()
      })
    })

    describe('currentCredentialId prop', () => {
      it('should reset dataList when currentCredentialId changes', () => {
        const pages = [
          createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
        ]
        const props = createDefaultProps({
          list: pages,
          pagesMap: createMockPagesMap(pages),
          currentCredentialId: 'cred-1',
        })

        const { rerender } = render(<PageSelector {...props} />)

        // Assert - Initial render
        expect(screen.getByText('Page 1')).toBeInTheDocument()

        // Rerender with new credential
        rerender(<PageSelector {...props} currentCredentialId="cred-2" />)

        // Assert - Should still show pages (reset and rebuild)
        expect(screen.getByText('Page 1')).toBeInTheDocument()
      })
    })
  })

  // State Management and Updates
  describe('State Management and Updates', () => {
    it('should initialize dataList with root level pages', () => {
      const { list, pagesMap, rootPage, childPage1 } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Assert - Only root level page should be visible initially
      expect(screen.getByText(rootPage.page_name)).toBeInTheDocument()
      // Child pages should not be visible until expanded
      expect(screen.queryByText(childPage1.page_name)).not.toBeInTheDocument()
    })

    it('should update dataList when expanding a page with children', () => {
      const { list, pagesMap, rootPage, childPage1, childPage2 } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Find and click the expand arrow (uses hover:bg-components-button-ghost-bg-hover class)
      const arrowButton = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      if (arrowButton)
        fireEvent.click(arrowButton)

      expect(screen.getByText(rootPage.page_name)).toBeInTheDocument()
      expect(screen.getByText(childPage1.page_name)).toBeInTheDocument()
      expect(screen.getByText(childPage2.page_name)).toBeInTheDocument()
    })

    it('should maintain currentPreviewPageId state', () => {
      const mockOnPreview = vi.fn()
      const pages = [
        createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
        createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
      ]
      const props = createDefaultProps({
        list: pages,
        pagesMap: createMockPagesMap(pages),
        onPreview: mockOnPreview,
        canPreview: true,
      })

      render(<PageSelector {...props} />)
      const previewButtons = screen.getAllByText('common.dataSource.notion.selector.preview')
      fireEvent.click(previewButtons[0])

      expect(mockOnPreview).toHaveBeenCalledWith('page-1')
    })

    it('should use searchDataList when searchValue is present', () => {
      const pages = [
        createMockPage({ page_id: 'page-1', page_name: 'Apple' }),
        createMockPage({ page_id: 'page-2', page_name: 'Banana' }),
      ]
      const props = createDefaultProps({
        list: pages,
        pagesMap: createMockPagesMap(pages),
        searchValue: 'Apple',
      })

      render(<PageSelector {...props} />)

      // Assert - Only pages matching search should be visible
      // Use getAllByText since the page name appears in both title div and breadcrumbs
      expect(screen.getAllByText('Apple').length).toBeGreaterThan(0)
      expect(screen.queryByText('Banana')).not.toBeInTheDocument()
    })
  })

  // Side Effects and Cleanup
  describe('Side Effects and Cleanup', () => {
    it('should reinitialize dataList when currentCredentialId changes', () => {
      const pages = [createMockPage({ page_id: 'page-1', page_name: 'Page 1' })]
      const props = createDefaultProps({
        list: pages,
        pagesMap: createMockPagesMap(pages),
        currentCredentialId: 'cred-1',
      })

      const { rerender } = render(<PageSelector {...props} />)
      expect(screen.getByText('Page 1')).toBeInTheDocument()

      // Change credential
      rerender(<PageSelector {...props} currentCredentialId="cred-2" />)

      // Assert - Component should still render correctly
      expect(screen.getByText('Page 1')).toBeInTheDocument()
    })

    it('should filter root pages correctly on initialization', () => {
      const { list, pagesMap, rootPage, childPage1 } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Assert - Only root level pages visible
      expect(screen.getByText(rootPage.page_name)).toBeInTheDocument()
      expect(screen.queryByText(childPage1.page_name)).not.toBeInTheDocument()
    })

    it('should include pages whose parent is not in pagesMap', () => {
      const orphanPage = createMockPage({
        page_id: 'orphan-page',
        page_name: 'Orphan Page',
        parent_id: 'non-existent-parent',
      })
      const props = createDefaultProps({
        list: [orphanPage],
        pagesMap: createMockPagesMap([orphanPage]),
      })

      render(<PageSelector {...props} />)

      // Assert - Orphan page should be visible at root level
      expect(screen.getByText('Orphan Page')).toBeInTheDocument()
    })
  })

  // Callback Stability and Memoization
  describe('Callback Stability and Memoization', () => {
    it('should have stable handleToggle that expands children', () => {
      const { list, pagesMap, childPage1, childPage2 } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Find expand arrow for root page (has RiArrowRightSLine icon)
      const expandArrow = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      if (expandArrow)
        fireEvent.click(expandArrow)

      // Assert - Children should be visible
      expect(screen.getByText(childPage1.page_name)).toBeInTheDocument()
      expect(screen.getByText(childPage2.page_name)).toBeInTheDocument()
    })

    it('should have stable handleToggle that collapses descendants', () => {
      const { list, pagesMap, childPage1, childPage2 } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // First expand
      const expandArrow = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      if (expandArrow) {
        fireEvent.click(expandArrow)
        // Then collapse
        fireEvent.click(expandArrow)
      }

      // Assert - Children should be hidden again
      expect(screen.queryByText(childPage1.page_name)).not.toBeInTheDocument()
      expect(screen.queryByText(childPage2.page_name)).not.toBeInTheDocument()
    })

    it('should have stable handleCheck that adds page and descendants to selection', () => {
      const mockOnSelect = vi.fn()
      const { list, pagesMap } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
        onSelect: mockOnSelect,
        checkedIds: new Set(),
        isMultipleChoice: true,
      })

      render(<PageSelector {...props} />)

      // Check the root page
      fireEvent.click(getCheckbox())

      // Assert - onSelect should be called with the page and its descendants
      expect(mockOnSelect).toHaveBeenCalled()
      const selectedSet = mockOnSelect.mock.calls[0][0] as Set<string>
      expect(selectedSet.has('root-page')).toBe(true)
    })

    it('should have stable handleCheck that removes page and descendants from selection', () => {
      const mockOnSelect = vi.fn()
      const { list, pagesMap } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
        onSelect: mockOnSelect,
        checkedIds: new Set(['root-page', 'child-1', 'child-2', 'grandchild-1']),
        isMultipleChoice: true,
      })

      render(<PageSelector {...props} />)

      // Uncheck the root page
      fireEvent.click(getCheckbox())

      // Assert - onSelect should be called with empty/reduced set
      expect(mockOnSelect).toHaveBeenCalled()
    })

    it('should have stable handlePreview that updates currentPreviewPageId', () => {
      const mockOnPreview = vi.fn()
      const page = createMockPage({ page_id: 'preview-page' })
      const props = createDefaultProps({
        list: [page],
        pagesMap: createMockPagesMap([page]),
        onPreview: mockOnPreview,
        canPreview: true,
      })

      render(<PageSelector {...props} />)
      fireEvent.click(screen.getByText('common.dataSource.notion.selector.preview'))

      expect(mockOnPreview).toHaveBeenCalledWith('preview-page')
    })
  })

  // Memoization Logic and Dependencies
  describe('Memoization Logic and Dependencies', () => {
    it('should compute listMapWithChildrenAndDescendants correctly', () => {
      const { list, pagesMap } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Assert - Tree structure should be built (verified by expand functionality)
      const expandArrow = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      expect(expandArrow).toBeInTheDocument() // Root page has children
    })

    it('should recompute listMapWithChildrenAndDescendants when list changes', () => {
      const initialList = [createMockPage({ page_id: 'page-1', page_name: 'Page 1' })]
      const props = createDefaultProps({
        list: initialList,
        pagesMap: createMockPagesMap(initialList),
      })

      const { rerender } = render(<PageSelector {...props} />)
      expect(screen.getByText('Page 1')).toBeInTheDocument()

      // Update with new list
      const newList = [
        createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
        createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
      ]
      rerender(<PageSelector {...props} list={newList} pagesMap={createMockPagesMap(newList)} />)

      expect(screen.getByText('Page 1')).toBeInTheDocument()
      // Page 2 won't show because dataList state hasn't updated (only resets on credentialId change)
    })

    it('should recompute listMapWithChildrenAndDescendants when pagesMap changes', () => {
      const initialList = [createMockPage({ page_id: 'page-1', page_name: 'Page 1' })]
      const props = createDefaultProps({
        list: initialList,
        pagesMap: createMockPagesMap(initialList),
      })

      const { rerender } = render(<PageSelector {...props} />)

      // Update pagesMap
      const newPagesMap = {
        ...createMockPagesMap(initialList),
        'page-2': { ...createMockPage({ page_id: 'page-2' }), workspace_id: 'ws-1' },
      }
      rerender(<PageSelector {...props} pagesMap={newPagesMap} />)

      // Assert - Should not throw
      expect(screen.getByText('Page 1')).toBeInTheDocument()
    })

    it('should handle empty list in memoization', () => {
      const props = createDefaultProps({
        list: [],
        pagesMap: {},
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()
    })
  })

  // User Interactions and Event Handlers
  describe('User Interactions and Event Handlers', () => {
    it('should toggle expansion when clicking arrow button', () => {
      const { list, pagesMap, childPage1 } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Initially children are hidden
      expect(screen.queryByText(childPage1.page_name)).not.toBeInTheDocument()

      const expandArrow = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      if (expandArrow)
        fireEvent.click(expandArrow)

      // Children become visible
      expect(screen.getByText(childPage1.page_name)).toBeInTheDocument()
    })

    it('should check/uncheck page when clicking checkbox', () => {
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({
        onSelect: mockOnSelect,
        checkedIds: new Set(),
      })

      render(<PageSelector {...props} />)
      fireEvent.click(getCheckbox())

      expect(mockOnSelect).toHaveBeenCalled()
    })

    it('should select radio when clicking in single choice mode', () => {
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({
        onSelect: mockOnSelect,
        isMultipleChoice: false,
        checkedIds: new Set(),
      })

      render(<PageSelector {...props} />)
      fireEvent.click(getRadio())

      expect(mockOnSelect).toHaveBeenCalled()
    })

    it('should clear previous selection in single choice mode', () => {
      const mockOnSelect = vi.fn()
      const pages = [
        createMockPage({ page_id: 'page-1', page_name: 'Page 1' }),
        createMockPage({ page_id: 'page-2', page_name: 'Page 2' }),
      ]
      const props = createDefaultProps({
        list: pages,
        pagesMap: createMockPagesMap(pages),
        onSelect: mockOnSelect,
        isMultipleChoice: false,
        checkedIds: new Set(['page-1']),
      })

      render(<PageSelector {...props} />)
      const radios = getAllRadios()
      fireEvent.click(radios[1]) // Click on page-2

      // Assert - Should clear page-1 and select page-2
      expect(mockOnSelect).toHaveBeenCalled()
      const selectedSet = mockOnSelect.mock.calls[0][0] as Set<string>
      expect(selectedSet.has('page-2')).toBe(true)
      expect(selectedSet.has('page-1')).toBe(false)
    })

    it('should trigger preview when clicking preview button', () => {
      const mockOnPreview = vi.fn()
      const props = createDefaultProps({
        onPreview: mockOnPreview,
        canPreview: true,
      })

      render(<PageSelector {...props} />)
      fireEvent.click(screen.getByText('common.dataSource.notion.selector.preview'))

      expect(mockOnPreview).toHaveBeenCalledWith('page-1')
    })

    it('should not cascade selection in search mode', () => {
      const mockOnSelect = vi.fn()
      const { list, pagesMap } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
        onSelect: mockOnSelect,
        checkedIds: new Set(),
        searchValue: 'Root',
        isMultipleChoice: true,
      })

      render(<PageSelector {...props} />)
      fireEvent.click(getCheckbox())

      // Assert - Only the clicked page should be selected (no descendants)
      expect(mockOnSelect).toHaveBeenCalled()
      const selectedSet = mockOnSelect.mock.calls[0][0] as Set<string>
      expect(selectedSet.size).toBe(1)
      expect(selectedSet.has('root-page')).toBe(true)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty list', () => {
      const props = createDefaultProps({
        list: [],
        pagesMap: {},
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText('common.dataSource.notion.selector.noSearchResult')).toBeInTheDocument()
    })

    it('should handle null page_icon', () => {
      const page = createMockPage({ page_icon: null })
      const props = createDefaultProps({
        list: [page],
        pagesMap: createMockPagesMap([page]),
      })

      render(<PageSelector {...props} />)

      // Assert - NotionIcon renders svg (RiFileTextLine) when page_icon is null
      const notionIcon = document.querySelector('.h-5.w-5')
      expect(notionIcon).toBeInTheDocument()
    })

    it('should handle page_icon with all properties', () => {
      const page = createMockPage({
        page_icon: { type: 'emoji', url: null, emoji: '📄' },
      })
      const props = createDefaultProps({
        list: [page],
        pagesMap: createMockPagesMap([page]),
      })

      render(<PageSelector {...props} />)

      // Assert - NotionIcon renders the emoji
      expect(screen.getByText('📄')).toBeInTheDocument()
    })

    it('should handle empty searchValue correctly', () => {
      const props = createDefaultProps({ searchValue: '' })

      render(<PageSelector {...props} />)

      expect(screen.getByTestId('virtual-list')).toBeInTheDocument()
    })

    it('should handle special characters in page name', () => {
      const page = createMockPage({ page_name: 'Test <script>alert("xss")</script>' })
      const props = createDefaultProps({
        list: [page],
        pagesMap: createMockPagesMap([page]),
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText('Test <script>alert("xss")</script>')).toBeInTheDocument()
    })

    it('should handle unicode characters in page name', () => {
      const page = createMockPage({ page_name: '测试页面 🔍 привет' })
      const props = createDefaultProps({
        list: [page],
        pagesMap: createMockPagesMap([page]),
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText('测试页面 🔍 привет')).toBeInTheDocument()
    })

    it('should handle very long page names', () => {
      const longName = 'A'.repeat(500)
      const page = createMockPage({ page_name: longName })
      const props = createDefaultProps({
        list: [page],
        pagesMap: createMockPagesMap([page]),
      })

      render(<PageSelector {...props} />)

      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle deeply nested hierarchy', () => {
      // Arrange - Create 5 levels deep
      const pages: DataSourceNotionPage[] = []
      let parentId = 'root'

      for (let i = 0; i < 5; i++) {
        const page = createMockPage({
          page_id: `level-${i}`,
          page_name: `Level ${i}`,
          parent_id: parentId,
        })
        pages.push(page)
        parentId = page.page_id
      }

      const props = createDefaultProps({
        list: pages,
        pagesMap: createMockPagesMap(pages),
      })

      render(<PageSelector {...props} />)

      // Assert - Only root level visible
      expect(screen.getByText('Level 0')).toBeInTheDocument()
      expect(screen.queryByText('Level 1')).not.toBeInTheDocument()
    })

    it('should handle page with missing parent reference gracefully', () => {
      // Arrange - Page whose parent doesn't exist in pagesMap (valid edge case)
      const orphanPage = createMockPage({
        page_id: 'orphan',
        page_name: 'Orphan Page',
        parent_id: 'non-existent-parent',
      })
      // Create pagesMap without the parent
      const pagesMap = createMockPagesMap([orphanPage])
      const props = createDefaultProps({
        list: [orphanPage],
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Assert - Should render the orphan page at root level
      expect(screen.getByText('Orphan Page')).toBeInTheDocument()
    })

    it('should handle empty checkedIds Set', () => {
      const props = createDefaultProps({ checkedIds: new Set() })

      render(<PageSelector {...props} />)

      const checkbox = getCheckbox()
      expect(checkbox).toBeInTheDocument()
      expect(isCheckboxChecked(checkbox)).toBe(false)
    })

    it('should handle empty disabledValue Set', () => {
      const props = createDefaultProps({ disabledValue: new Set() })

      render(<PageSelector {...props} />)

      const checkbox = getCheckbox()
      expect(checkbox).toBeInTheDocument()
      expect(isCheckboxDisabled(checkbox)).toBe(false)
    })

    it('should handle undefined onPreview gracefully', () => {
      const props = createDefaultProps({
        onPreview: undefined,
        canPreview: true,
      })

      render(<PageSelector {...props} />)

      // Assert - Click should not throw
      expect(() => {
        fireEvent.click(screen.getByText('common.dataSource.notion.selector.preview'))
      }).not.toThrow()
    })

    it('should handle page without descendants correctly', () => {
      const leafPage = createMockPage({ page_id: 'leaf', page_name: 'Leaf Page' })
      const props = createDefaultProps({
        list: [leafPage],
        pagesMap: createMockPagesMap([leafPage]),
      })

      render(<PageSelector {...props} />)

      // Assert - No expand arrow for leaf pages
      const arrowButton = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      expect(arrowButton).not.toBeInTheDocument()
    })
  })

  // All Prop Variations
  describe('Prop Variations', () => {
    it.each([
      [{ canPreview: true, isMultipleChoice: true }],
      [{ canPreview: true, isMultipleChoice: false }],
      [{ canPreview: false, isMultipleChoice: true }],
      [{ canPreview: false, isMultipleChoice: false }],
    ])('should render correctly with props %o', (propVariation) => {
      const props = createDefaultProps(propVariation)

      render(<PageSelector {...props} />)

      expect(screen.getByTestId('virtual-list')).toBeInTheDocument()
      if (propVariation.canPreview)
        expect(screen.getByText('common.dataSource.notion.selector.preview')).toBeInTheDocument()
      else
        expect(screen.queryByText('common.dataSource.notion.selector.preview')).not.toBeInTheDocument()

      if (propVariation.isMultipleChoice)
        expect(getCheckbox()).toBeInTheDocument()
      else
        expect(getRadio()).toBeInTheDocument()
    })

    it('should handle all default prop values', () => {
      const minimalProps: PageSelectorProps = {
        checkedIds: new Set(),
        disabledValue: new Set(),
        searchValue: '',
        pagesMap: createMockPagesMap([createMockPage()]),
        list: [createMockPage()],
        onSelect: vi.fn(),
        currentCredentialId: 'cred-1',
        // canPreview defaults to true
        // isMultipleChoice defaults to true
      }

      render(<PageSelector {...minimalProps} />)

      // Assert - Defaults should be applied
      expect(getCheckbox()).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.selector.preview')).toBeInTheDocument()
    })
  })

  // Utils Function Tests
  describe('Utils - recursivePushInParentDescendants', () => {
    it('should build tree structure for simple parent-child relationship', () => {
      const parent = createMockPage({ page_id: 'parent', page_name: 'Parent', parent_id: 'root' })
      const child = createMockPage({ page_id: 'child', page_name: 'Child', parent_id: 'parent' })
      const pagesMap = createMockPagesMap([parent, child])
      const listTreeMap: NotionPageTreeMap = {}

      // Create initial entry for child
      const childEntry: NotionPageTreeItem = {
        ...child,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }
      listTreeMap[child.page_id] = childEntry

      recursivePushInParentDescendants(pagesMap, listTreeMap, childEntry, childEntry)

      expect(listTreeMap.parent).toBeDefined()
      expect(listTreeMap.parent.children.has('child')).toBe(true)
      expect(listTreeMap.parent.descendants.has('child')).toBe(true)
      expect(childEntry.depth).toBe(1)
      expect(childEntry.ancestors).toContain('Parent')
    })

    it('should handle root level pages', () => {
      const rootPage = createMockPage({ page_id: 'root-page', parent_id: 'root' })
      const pagesMap = createMockPagesMap([rootPage])
      const listTreeMap: NotionPageTreeMap = {}

      const rootEntry: NotionPageTreeItem = {
        ...rootPage,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }
      listTreeMap[rootPage.page_id] = rootEntry

      recursivePushInParentDescendants(pagesMap, listTreeMap, rootEntry, rootEntry)

      // Assert - No parent should be created for root level
      expect(Object.keys(listTreeMap)).toHaveLength(1)
      expect(rootEntry.depth).toBe(0)
      expect(rootEntry.ancestors).toHaveLength(0)
    })

    it('should handle missing parent in pagesMap', () => {
      const orphan = createMockPage({ page_id: 'orphan', parent_id: 'missing-parent' })
      const pagesMap = createMockPagesMap([orphan])
      const listTreeMap: NotionPageTreeMap = {}

      const orphanEntry: NotionPageTreeItem = {
        ...orphan,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }
      listTreeMap[orphan.page_id] = orphanEntry

      recursivePushInParentDescendants(pagesMap, listTreeMap, orphanEntry, orphanEntry)

      // Assert - Should not create parent entry for missing parent
      expect(listTreeMap['missing-parent']).toBeUndefined()
    })

    it('should handle null parent_id', () => {
      const page = createMockPage({ page_id: 'page', parent_id: '' })
      const pagesMap = createMockPagesMap([page])
      const listTreeMap: NotionPageTreeMap = {}

      const pageEntry: NotionPageTreeItem = {
        ...page,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }
      listTreeMap[page.page_id] = pageEntry

      recursivePushInParentDescendants(pagesMap, listTreeMap, pageEntry, pageEntry)

      // Assert - Early return, no changes
      expect(Object.keys(listTreeMap)).toHaveLength(1)
    })

    it('should accumulate depth for deeply nested pages', () => {
      // Arrange - 3 levels deep
      const level0 = createMockPage({ page_id: 'l0', page_name: 'Level 0', parent_id: 'root' })
      const level1 = createMockPage({ page_id: 'l1', page_name: 'Level 1', parent_id: 'l0' })
      const level2 = createMockPage({ page_id: 'l2', page_name: 'Level 2', parent_id: 'l1' })
      const pagesMap = createMockPagesMap([level0, level1, level2])
      const listTreeMap: NotionPageTreeMap = {}

      // Add all levels
      const l0Entry: NotionPageTreeItem = {
        ...level0,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }
      const l1Entry: NotionPageTreeItem = {
        ...level1,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }
      const l2Entry: NotionPageTreeItem = {
        ...level2,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }

      listTreeMap[level0.page_id] = l0Entry
      listTreeMap[level1.page_id] = l1Entry
      listTreeMap[level2.page_id] = l2Entry

      // Act - Process from leaf to root
      recursivePushInParentDescendants(pagesMap, listTreeMap, l2Entry, l2Entry)

      expect(l2Entry.depth).toBe(2)
      expect(l2Entry.ancestors).toEqual(['Level 0', 'Level 1'])
      expect(listTreeMap.l1.children.has('l2')).toBe(true)
      expect(listTreeMap.l0.descendants.has('l2')).toBe(true)
    })

    it('should update existing parent entry', () => {
      const parent = createMockPage({ page_id: 'parent', page_name: 'Parent', parent_id: 'root' })
      const child1 = createMockPage({ page_id: 'child1', parent_id: 'parent' })
      const child2 = createMockPage({ page_id: 'child2', parent_id: 'parent' })
      const pagesMap = createMockPagesMap([parent, child1, child2])
      const listTreeMap: NotionPageTreeMap = {}

      // Pre-create parent entry
      listTreeMap.parent = {
        ...parent,
        children: new Set(['child1']),
        descendants: new Set(['child1']),
        depth: 0,
        ancestors: [],
      }

      const child2Entry: NotionPageTreeItem = {
        ...child2,
        children: new Set(),
        descendants: new Set(),
        depth: 0,
        ancestors: [],
      }
      listTreeMap[child2.page_id] = child2Entry

      recursivePushInParentDescendants(pagesMap, listTreeMap, child2Entry, child2Entry)

      // Assert - Should add child2 to existing parent
      expect(listTreeMap.parent.children.has('child1')).toBe(true)
      expect(listTreeMap.parent.children.has('child2')).toBe(true)
      expect(listTreeMap.parent.descendants.has('child1')).toBe(true)
      expect(listTreeMap.parent.descendants.has('child2')).toBe(true)
    })
  })

  // Item Component Integration Tests
  describe('Item Component Integration', () => {
    it('should render item with correct styling for preview state', () => {
      const page = createMockPage({ page_id: 'page-1', page_name: 'Test Page' })
      const props = createDefaultProps({
        list: [page],
        pagesMap: createMockPagesMap([page]),
        canPreview: true,
      })

      render(<PageSelector {...props} />)

      fireEvent.click(screen.getByText('common.dataSource.notion.selector.preview'))

      // Assert - Item should have preview styling class
      const itemContainer = screen.getByText('Test Page').closest('[class*="group"]')
      expect(itemContainer).toHaveClass('bg-state-base-hover')
    })

    it('should show arrow for pages with children', () => {
      const { list, pagesMap } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
      })

      render(<PageSelector {...props} />)

      // Assert - Root page should have expand arrow
      const arrowContainer = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      expect(arrowContainer).toBeInTheDocument()
    })

    it('should not show arrow for leaf pages', () => {
      const leafPage = createMockPage({ page_id: 'leaf', page_name: 'Leaf' })
      const props = createDefaultProps({
        list: [leafPage],
        pagesMap: createMockPagesMap([leafPage]),
      })

      render(<PageSelector {...props} />)

      // Assert - No expand arrow for leaf pages
      const arrowContainer = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      expect(arrowContainer).not.toBeInTheDocument()
    })

    it('should hide arrows in search mode', () => {
      const { list, pagesMap } = createHierarchicalPages()
      const props = createDefaultProps({
        list,
        pagesMap,
        searchValue: 'Root',
      })

      render(<PageSelector {...props} />)

      // Assert - No expand arrows in search mode (renderArrow returns null when searchValue)
      // The arrows are only shown when !searchValue
      const arrowContainer = document.querySelector('[class*="hover:bg-components-button-ghost-bg-hover"]')
      expect(arrowContainer).not.toBeInTheDocument()
    })
  })
})
