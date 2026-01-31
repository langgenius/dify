import type { Category, Tag } from './constant'
import type { FilterState } from './index'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ==================== Imports (after mocks) ====================

import CategoriesFilter from './category-filter'
// Import real components
import FilterManagement from './index'
import SearchBox from './search-box'
import { useStore } from './store'
import TagFilter from './tag-filter'

// ==================== Mock Setup ====================

// Mock initial filters from context
let mockInitFilters: FilterState = {
  categories: [],
  tags: [],
  searchQuery: '',
}

vi.mock('../context', () => ({
  usePluginPageContext: (selector: (v: { filters: FilterState }) => FilterState) =>
    selector({ filters: mockInitFilters }),
}))

// Mock categories data
const mockCategories = [
  { name: 'model', label: 'Models' },
  { name: 'tool', label: 'Tools' },
  { name: 'extension', label: 'Extensions' },
  { name: 'agent', label: 'Agents' },
]

const mockCategoriesMap: Record<string, { name: string, label: string }> = {
  model: { name: 'model', label: 'Models' },
  tool: { name: 'tool', label: 'Tools' },
  extension: { name: 'extension', label: 'Extensions' },
  agent: { name: 'agent', label: 'Agents' },
}

// Mock tags data
const mockTags = [
  { name: 'agent', label: 'Agent' },
  { name: 'rag', label: 'RAG' },
  { name: 'search', label: 'Search' },
  { name: 'image', label: 'Image' },
]

const mockTagsMap: Record<string, { name: string, label: string }> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
  image: { name: 'image', label: 'Image' },
}

vi.mock('../../hooks', () => ({
  useCategories: () => ({
    categories: mockCategories,
    categoriesMap: mockCategoriesMap,
  }),
  useTags: () => ({
    tags: mockTags,
    tagsMap: mockTagsMap,
    getTagLabel: (name: string) => mockTagsMap[name]?.label || name,
  }),
}))

// Track portal open state for testing
let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => {
    mockPortalOpenState = open
    return <div data-testid="portal-container" data-open={open}>{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children, className }: { children: React.ReactNode, className?: string }) => {
    if (!mockPortalOpenState)
      return null
    return <div data-testid="portal-content" className={className}>{children}</div>
  },
}))

// ==================== Test Utilities ====================

const createFilterState = (overrides: Partial<FilterState> = {}): FilterState => ({
  categories: [],
  tags: [],
  searchQuery: '',
  ...overrides,
})

const renderFilterManagement = (onFilterChange = vi.fn()) => {
  const result = render(<FilterManagement onFilterChange={onFilterChange} />)
  return { ...result, onFilterChange }
}

// ==================== constant.ts Tests ====================
describe('constant.ts - Type Definitions', () => {
  it('should define Tag type correctly', () => {
    // Arrange
    const tag: Tag = {
      id: 'test-id',
      name: 'test-tag',
      type: 'custom',
      binding_count: 5,
    }

    // Assert
    expect(tag.id).toBe('test-id')
    expect(tag.name).toBe('test-tag')
    expect(tag.type).toBe('custom')
    expect(tag.binding_count).toBe(5)
  })

  it('should define Category type correctly', () => {
    // Arrange
    const category: Category = {
      name: 'model',
      binding_count: 10,
    }

    // Assert
    expect(category.name).toBe('model')
    expect(category.binding_count).toBe(10)
  })

  it('should enforce Category name as specific union type', () => {
    // Arrange - Valid category names
    const validNames: Array<Category['name']> = ['model', 'tool', 'extension', 'bundle']

    // Assert
    validNames.forEach((name) => {
      const category: Category = { name, binding_count: 0 }
      expect(['model', 'tool', 'extension', 'bundle']).toContain(category.name)
    })
  })
})

// ==================== store.ts Tests ====================
describe('store.ts - Zustand Store', () => {
  describe('Initial State', () => {
    it('should have empty tagList initially', () => {
      const { result } = renderHook(() => useStore(state => state.tagList))
      expect(result.current).toEqual([])
    })

    it('should have empty categoryList initially', () => {
      const { result } = renderHook(() => useStore(state => state.categoryList))
      expect(result.current).toEqual([])
    })

    it('should have showTagManagementModal false initially', () => {
      const { result } = renderHook(() => useStore(state => state.showTagManagementModal))
      expect(result.current).toBe(false)
    })

    it('should have showCategoryManagementModal false initially', () => {
      const { result } = renderHook(() => useStore(state => state.showCategoryManagementModal))
      expect(result.current).toBe(false)
    })
  })

  describe('setTagList', () => {
    it('should update tagList', () => {
      // Arrange
      const mockTagList: Tag[] = [
        { id: '1', name: 'tag1', type: 'custom', binding_count: 1 },
        { id: '2', name: 'tag2', type: 'custom', binding_count: 2 },
      ]

      // Act
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setTagList(mockTagList)
      })

      // Assert
      expect(result.current.tagList).toEqual(mockTagList)
    })

    it('should handle undefined tagList', () => {
      // Arrange & Act
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setTagList(undefined)
      })

      // Assert
      expect(result.current.tagList).toBeUndefined()
    })

    it('should handle empty tagList', () => {
      // Arrange
      const { result } = renderHook(() => useStore())

      // First set some tags
      act(() => {
        result.current.setTagList([{ id: '1', name: 'tag1', type: 'custom', binding_count: 1 }])
      })

      // Act - Clear the list
      act(() => {
        result.current.setTagList([])
      })

      // Assert
      expect(result.current.tagList).toEqual([])
    })
  })

  describe('setCategoryList', () => {
    it('should update categoryList', () => {
      // Arrange
      const mockCategoryList: Category[] = [
        { name: 'model', binding_count: 5 },
        { name: 'tool', binding_count: 10 },
      ]

      // Act
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setCategoryList(mockCategoryList)
      })

      // Assert
      expect(result.current.categoryList).toEqual(mockCategoryList)
    })

    it('should handle undefined categoryList', () => {
      // Arrange & Act
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setCategoryList(undefined)
      })

      // Assert
      expect(result.current.categoryList).toBeUndefined()
    })
  })

  describe('setShowTagManagementModal', () => {
    it('should set showTagManagementModal to true', () => {
      // Arrange & Act
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setShowTagManagementModal(true)
      })

      // Assert
      expect(result.current.showTagManagementModal).toBe(true)
    })

    it('should set showTagManagementModal to false', () => {
      // Arrange
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setShowTagManagementModal(true)
      })

      // Act
      act(() => {
        result.current.setShowTagManagementModal(false)
      })

      // Assert
      expect(result.current.showTagManagementModal).toBe(false)
    })
  })

  describe('setShowCategoryManagementModal', () => {
    it('should set showCategoryManagementModal to true', () => {
      // Arrange & Act
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setShowCategoryManagementModal(true)
      })

      // Assert
      expect(result.current.showCategoryManagementModal).toBe(true)
    })

    it('should set showCategoryManagementModal to false', () => {
      // Arrange
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setShowCategoryManagementModal(true)
      })

      // Act
      act(() => {
        result.current.setShowCategoryManagementModal(false)
      })

      // Assert
      expect(result.current.showCategoryManagementModal).toBe(false)
    })
  })

  describe('Store Isolation', () => {
    it('should maintain separate state for each property', () => {
      // Arrange
      const mockTagList: Tag[] = [{ id: '1', name: 'tag1', type: 'custom', binding_count: 1 }]
      const mockCategoryList: Category[] = [{ name: 'model', binding_count: 5 }]

      // Act
      const { result } = renderHook(() => useStore())
      act(() => {
        result.current.setTagList(mockTagList)
        result.current.setCategoryList(mockCategoryList)
        result.current.setShowTagManagementModal(true)
        result.current.setShowCategoryManagementModal(false)
      })

      // Assert - All states are independent
      expect(result.current.tagList).toEqual(mockTagList)
      expect(result.current.categoryList).toEqual(mockCategoryList)
      expect(result.current.showTagManagementModal).toBe(true)
      expect(result.current.showCategoryManagementModal).toBe(false)
    })
  })
})

// ==================== search-box.tsx Tests ====================
describe('SearchBox Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render input with correct placeholder', () => {
      // Arrange & Act
      render(<SearchBox searchQuery="" onChange={vi.fn()} />)

      // Assert
      expect(screen.getByPlaceholderText('plugin.search')).toBeInTheDocument()
    })

    it('should render with provided searchQuery value', () => {
      // Arrange & Act
      render(<SearchBox searchQuery="test query" onChange={vi.fn()} />)

      // Assert
      expect(screen.getByDisplayValue('test query')).toBeInTheDocument()
    })

    it('should render search icon', () => {
      // Arrange & Act
      const { container } = render(<SearchBox searchQuery="" onChange={vi.fn()} />)

      // Assert - Input should have showLeftIcon which renders search icon
      const wrapper = container.querySelector('.w-\\[200px\\]')
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when input value changes', () => {
      // Arrange
      const handleChange = vi.fn()
      render(<SearchBox searchQuery="" onChange={handleChange} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: 'new search' },
      })

      // Assert
      expect(handleChange).toHaveBeenCalledWith('new search')
    })

    it('should call onChange with empty string when cleared', () => {
      // Arrange
      const handleChange = vi.fn()
      render(<SearchBox searchQuery="existing" onChange={handleChange} />)

      // Act
      fireEvent.change(screen.getByDisplayValue('existing'), {
        target: { value: '' },
      })

      // Assert
      expect(handleChange).toHaveBeenCalledWith('')
    })

    it('should handle rapid typing', () => {
      // Arrange
      const handleChange = vi.fn()
      render(<SearchBox searchQuery="" onChange={handleChange} />)
      const input = screen.getByPlaceholderText('plugin.search')

      // Act
      fireEvent.change(input, { target: { value: 'a' } })
      fireEvent.change(input, { target: { value: 'ab' } })
      fireEvent.change(input, { target: { value: 'abc' } })

      // Assert
      expect(handleChange).toHaveBeenCalledTimes(3)
      expect(handleChange).toHaveBeenLastCalledWith('abc')
    })
  })

  describe('Edge Cases', () => {
    it('should handle special characters', () => {
      // Arrange
      const handleChange = vi.fn()
      render(<SearchBox searchQuery="" onChange={handleChange} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: '!@#$%^&*()' },
      })

      // Assert
      expect(handleChange).toHaveBeenCalledWith('!@#$%^&*()')
    })

    it('should handle unicode characters', () => {
      // Arrange
      const handleChange = vi.fn()
      render(<SearchBox searchQuery="" onChange={handleChange} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: '中文搜索 🔍' },
      })

      // Assert
      expect(handleChange).toHaveBeenCalledWith('中文搜索 🔍')
    })

    it('should handle very long input', () => {
      // Arrange
      const handleChange = vi.fn()
      const longText = 'a'.repeat(500)
      render(<SearchBox searchQuery="" onChange={handleChange} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: longText },
      })

      // Assert
      expect(handleChange).toHaveBeenCalledWith(longText)
    })
  })
})

// ==================== category-filter.tsx Tests ====================
describe('CategoriesFilter Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  describe('Rendering', () => {
    it('should render with "All Categories" text when no selection', () => {
      // Arrange & Act
      render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Assert
      expect(screen.getByText('plugin.allCategories')).toBeInTheDocument()
    })

    it('should render dropdown arrow when no selection', () => {
      // Arrange & Act
      const { container } = render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Assert - Arrow icon should be visible
      const arrowIcon = container.querySelector('svg')
      expect(arrowIcon).toBeInTheDocument()
    })

    it('should render selected category labels', () => {
      // Arrange & Act
      render(<CategoriesFilter value={['model']} onChange={vi.fn()} />)

      // Assert
      expect(screen.getByText('Models')).toBeInTheDocument()
    })

    it('should show clear button when categories are selected', () => {
      // Arrange & Act
      const { container } = render(<CategoriesFilter value={['model']} onChange={vi.fn()} />)

      // Assert - Close icon should be visible
      const closeIcon = container.querySelector('[class*="cursor-pointer"]')
      expect(closeIcon).toBeInTheDocument()
    })

    it('should show count badge for more than 2 selections', () => {
      // Arrange & Act
      render(<CategoriesFilter value={['model', 'tool', 'extension']} onChange={vi.fn()} />)

      // Assert
      expect(screen.getByText('+1')).toBeInTheDocument()
    })
  })

  describe('Dropdown Behavior', () => {
    it('should open dropdown on trigger click', async () => {
      // Arrange
      render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      })
    })

    it('should display category options in dropdown', async () => {
      // Arrange
      render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Models')).toBeInTheDocument()
        expect(screen.getByText('Tools')).toBeInTheDocument()
        expect(screen.getByText('Extensions')).toBeInTheDocument()
        expect(screen.getByText('Agents')).toBeInTheDocument()
      })
    })

    it('should have search input in dropdown', async () => {
      // Arrange
      render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByPlaceholderText('plugin.searchCategories')).toBeInTheDocument()
      })
    })
  })

  describe('Selection Behavior', () => {
    it('should call onChange when category is selected', async () => {
      // Arrange
      const handleChange = vi.fn()
      render(<CategoriesFilter value={[]} onChange={handleChange} />)

      // Act - Open dropdown and click category
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        expect(screen.getByText('Models')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Models'))

      // Assert
      expect(handleChange).toHaveBeenCalledWith(['model'])
    })

    it('should deselect when clicking selected category', async () => {
      // Arrange
      const handleChange = vi.fn()
      render(<CategoriesFilter value={['model']} onChange={handleChange} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        // Multiple "Models" texts exist - one in trigger, one in dropdown
        const allModels = screen.getAllByText('Models')
        expect(allModels.length).toBeGreaterThan(1)
      })
      // Click the one in the dropdown (inside portal-content)
      const portalContent = screen.getByTestId('portal-content')
      const modelsInDropdown = portalContent.querySelector('.system-sm-medium')!
      fireEvent.click(modelsInDropdown.parentElement!)

      // Assert
      expect(handleChange).toHaveBeenCalledWith([])
    })

    it('should add to selection when clicking unselected category', async () => {
      // Arrange
      const handleChange = vi.fn()
      render(<CategoriesFilter value={['model']} onChange={handleChange} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        expect(screen.getByText('Tools')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Tools'))

      // Assert
      expect(handleChange).toHaveBeenCalledWith(['model', 'tool'])
    })

    it('should clear all selections when clear button is clicked', () => {
      // Arrange
      const handleChange = vi.fn()
      const { container } = render(<CategoriesFilter value={['model', 'tool']} onChange={handleChange} />)

      // Act - Find and click the close icon
      const closeIcon = container.querySelector('.text-text-quaternary')
      expect(closeIcon).toBeInTheDocument()
      fireEvent.click(closeIcon!)

      // Assert
      expect(handleChange).toHaveBeenCalledWith([])
    })
  })

  describe('Search Functionality', () => {
    it('should filter categories based on search text', async () => {
      // Arrange
      render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('plugin.searchCategories')).toBeInTheDocument()
      })
      fireEvent.change(screen.getByPlaceholderText('plugin.searchCategories'), {
        target: { value: 'mod' },
      })

      // Assert
      expect(screen.getByText('Models')).toBeInTheDocument()
      expect(screen.queryByText('Extensions')).not.toBeInTheDocument()
    })

    it('should be case insensitive', async () => {
      // Arrange
      render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('plugin.searchCategories')).toBeInTheDocument()
      })
      fireEvent.change(screen.getByPlaceholderText('plugin.searchCategories'), {
        target: { value: 'MOD' },
      })

      // Assert
      expect(screen.getByText('Models')).toBeInTheDocument()
    })
  })

  describe('Checkbox State', () => {
    it('should show checked checkbox for selected categories', async () => {
      // Arrange
      render(<CategoriesFilter value={['model']} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert - Check icon appears for checked state
      await waitFor(() => {
        const checkIcons = screen.getAllByTestId(/check-icon/)
        expect(checkIcons.length).toBeGreaterThan(0)
      })
    })

    it('should show unchecked checkbox for unselected categories', async () => {
      // Arrange
      render(<CategoriesFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert - No check icon for unchecked state
      await waitFor(() => {
        const checkIcons = screen.queryAllByTestId(/check-icon/)
        expect(checkIcons.length).toBe(0)
      })
    })
  })
})

// ==================== tag-filter.tsx Tests ====================
describe('TagFilter Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  describe('Rendering', () => {
    it('should render with "All Tags" text when no selection', () => {
      // Arrange & Act
      render(<TagFilter value={[]} onChange={vi.fn()} />)

      // Assert
      expect(screen.getByText('pluginTags.allTags')).toBeInTheDocument()
    })

    it('should render selected tag labels', () => {
      // Arrange & Act
      render(<TagFilter value={['agent']} onChange={vi.fn()} />)

      // Assert
      expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    it('should show count badge for more than 2 selections', () => {
      // Arrange & Act
      render(<TagFilter value={['agent', 'rag', 'search']} onChange={vi.fn()} />)

      // Assert
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('should show clear button when tags are selected', () => {
      // Arrange & Act
      const { container } = render(<TagFilter value={['agent']} onChange={vi.fn()} />)

      // Assert
      const closeIcon = container.querySelector('.text-text-quaternary')
      expect(closeIcon).toBeInTheDocument()
    })
  })

  describe('Dropdown Behavior', () => {
    it('should open dropdown on trigger click', async () => {
      // Arrange
      render(<TagFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      })
    })

    it('should display tag options in dropdown', async () => {
      // Arrange
      render(<TagFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Agent')).toBeInTheDocument()
        expect(screen.getByText('RAG')).toBeInTheDocument()
        expect(screen.getByText('Search')).toBeInTheDocument()
        expect(screen.getByText('Image')).toBeInTheDocument()
      })
    })
  })

  describe('Selection Behavior', () => {
    it('should call onChange when tag is selected', async () => {
      // Arrange
      const handleChange = vi.fn()
      render(<TagFilter value={[]} onChange={handleChange} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        expect(screen.getByText('Agent')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Agent'))

      // Assert
      expect(handleChange).toHaveBeenCalledWith(['agent'])
    })

    it('should deselect when clicking selected tag', async () => {
      // Arrange
      const handleChange = vi.fn()
      render(<TagFilter value={['agent']} onChange={handleChange} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        // Find the Agent option in dropdown
        const agentOptions = screen.getAllByText('Agent')
        fireEvent.click(agentOptions[agentOptions.length - 1])
      })

      // Assert
      expect(handleChange).toHaveBeenCalledWith([])
    })

    it('should add to selection when clicking unselected tag', async () => {
      // Arrange
      const handleChange = vi.fn()
      render(<TagFilter value={['agent']} onChange={handleChange} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        expect(screen.getByText('RAG')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('RAG'))

      // Assert
      expect(handleChange).toHaveBeenCalledWith(['agent', 'rag'])
    })

    it('should clear all selections when clear button is clicked', () => {
      // Arrange
      const handleChange = vi.fn()
      const { container } = render(<TagFilter value={['agent', 'rag']} onChange={handleChange} />)

      // Act
      const closeIcon = container.querySelector('.text-text-quaternary')
      fireEvent.click(closeIcon!)

      // Assert
      expect(handleChange).toHaveBeenCalledWith([])
    })
  })

  describe('Search Functionality', () => {
    it('should filter tags based on search text', async () => {
      // Arrange
      render(<TagFilter value={[]} onChange={vi.fn()} />)

      // Act
      fireEvent.click(screen.getByTestId('portal-trigger'))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('pluginTags.searchTags')).toBeInTheDocument()
      })
      fireEvent.change(screen.getByPlaceholderText('pluginTags.searchTags'), {
        target: { value: 'rag' },
      })

      // Assert
      expect(screen.getByText('RAG')).toBeInTheDocument()
      expect(screen.queryByText('Image')).not.toBeInTheDocument()
    })
  })
})

// ==================== index.tsx (FilterManagement) Tests ====================
describe('FilterManagement Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInitFilters = createFilterState()
    mockPortalOpenState = false
  })

  describe('Rendering', () => {
    it('should render all filter components', () => {
      // Arrange & Act
      renderFilterManagement()

      // Assert - All three filters should be present
      expect(screen.getByText('plugin.allCategories')).toBeInTheDocument()
      expect(screen.getByText('pluginTags.allTags')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('plugin.search')).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      // Arrange & Act
      const { container } = renderFilterManagement()

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'items-center', 'gap-2', 'self-stretch')
    })
  })

  describe('Initial State from Context', () => {
    it('should initialize with empty filters', () => {
      // Arrange
      mockInitFilters = createFilterState()

      // Act
      renderFilterManagement()

      // Assert
      expect(screen.getByText('plugin.allCategories')).toBeInTheDocument()
      expect(screen.getByText('pluginTags.allTags')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('plugin.search')).toHaveValue('')
    })

    it('should initialize with pre-selected categories', () => {
      // Arrange
      mockInitFilters = createFilterState({ categories: ['model'] })

      // Act
      renderFilterManagement()

      // Assert
      expect(screen.getByText('Models')).toBeInTheDocument()
    })

    it('should initialize with pre-selected tags', () => {
      // Arrange
      mockInitFilters = createFilterState({ tags: ['agent'] })

      // Act
      renderFilterManagement()

      // Assert
      expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    it('should initialize with search query', () => {
      // Arrange
      mockInitFilters = createFilterState({ searchQuery: 'initial search' })

      // Act
      renderFilterManagement()

      // Assert
      expect(screen.getByDisplayValue('initial search')).toBeInTheDocument()
    })
  })

  describe('Filter Interactions', () => {
    it('should call onFilterChange when category is selected', async () => {
      // Arrange
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act - Open categories dropdown and select
      const triggers = screen.getAllByTestId('portal-trigger')
      fireEvent.click(triggers[0]) // Categories filter trigger

      await waitFor(() => {
        expect(screen.getByText('Models')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Models'))

      // Assert
      expect(onFilterChange).toHaveBeenCalledWith({
        categories: ['model'],
        tags: [],
        searchQuery: '',
      })
    })

    it('should call onFilterChange when tag is selected', async () => {
      // Arrange
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act - Open tags dropdown and select
      const triggers = screen.getAllByTestId('portal-trigger')
      fireEvent.click(triggers[1]) // Tags filter trigger

      await waitFor(() => {
        expect(screen.getByText('Agent')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Agent'))

      // Assert
      expect(onFilterChange).toHaveBeenCalledWith({
        categories: [],
        tags: ['agent'],
        searchQuery: '',
      })
    })

    it('should call onFilterChange when search query changes', () => {
      // Arrange
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: 'test query' },
      })

      // Assert
      expect(onFilterChange).toHaveBeenCalledWith({
        categories: [],
        tags: [],
        searchQuery: 'test query',
      })
    })
  })

  describe('State Management', () => {
    it('should accumulate filter changes', async () => {
      // Arrange
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act 1 - Select a category
      const triggers = screen.getAllByTestId('portal-trigger')
      fireEvent.click(triggers[0])
      await waitFor(() => {
        expect(screen.getByText('Models')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Models'))

      expect(onFilterChange).toHaveBeenLastCalledWith({
        categories: ['model'],
        tags: [],
        searchQuery: '',
      })

      // Close dropdown by clicking trigger again
      fireEvent.click(triggers[0])

      // Act 2 - Select a tag (state should include previous category)
      fireEvent.click(triggers[1])
      await waitFor(() => {
        expect(screen.getByText('Agent')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Agent'))

      // Assert - Both category and tag should be in the state
      expect(onFilterChange).toHaveBeenLastCalledWith({
        categories: ['model'],
        tags: ['agent'],
        searchQuery: '',
      })
    })

    it('should preserve other filters when updating one', () => {
      // Arrange
      mockInitFilters = createFilterState({
        categories: ['model'],
        tags: ['agent'],
      })
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act - Change only search query
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: 'new search' },
      })

      // Assert - Other filters should be preserved
      expect(onFilterChange).toHaveBeenCalledWith({
        categories: ['model'],
        tags: ['agent'],
        searchQuery: 'new search',
      })
    })
  })

  describe('Integration Tests', () => {
    it('should handle complete filter workflow', async () => {
      // Arrange
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act 1 - Select categories
      const triggers = screen.getAllByTestId('portal-trigger')
      fireEvent.click(triggers[0])
      await waitFor(() => {
        expect(screen.getByText('Models')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Models'))
      fireEvent.click(triggers[0]) // Close

      // Act 2 - Select tags
      fireEvent.click(triggers[1])
      await waitFor(() => {
        expect(screen.getByText('RAG')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('RAG'))
      fireEvent.click(triggers[1]) // Close

      // Act 3 - Enter search
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: 'gpt' },
      })

      // Assert - Final state should include all filters
      expect(onFilterChange).toHaveBeenLastCalledWith({
        categories: ['model'],
        tags: ['rag'],
        searchQuery: 'gpt',
      })
    })

    it('should handle filter clearing', async () => {
      // Arrange
      mockInitFilters = createFilterState({
        categories: ['model'],
        tags: ['agent'],
        searchQuery: 'test',
      })
      const onFilterChange = vi.fn()
      const { container } = render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act - Clear search
      fireEvent.change(screen.getByDisplayValue('test'), {
        target: { value: '' },
      })

      // Assert
      expect(onFilterChange).toHaveBeenLastCalledWith({
        categories: ['model'],
        tags: ['agent'],
        searchQuery: '',
      })

      // Act - Clear categories (click clear button)
      const closeIcons = container.querySelectorAll('.text-text-quaternary')
      fireEvent.click(closeIcons[0]) // First close icon is for categories

      // Assert
      expect(onFilterChange).toHaveBeenLastCalledWith({
        categories: [],
        tags: ['agent'],
        searchQuery: '',
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty initial state', () => {
      // Arrange
      mockInitFilters = createFilterState()
      const onFilterChange = vi.fn()

      // Act
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Assert - Should render without errors
      expect(screen.getByText('plugin.allCategories')).toBeInTheDocument()
    })

    it('should handle multiple rapid filter changes', () => {
      // Arrange
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act - Rapid search input changes
      const searchInput = screen.getByPlaceholderText('plugin.search')
      fireEvent.change(searchInput, { target: { value: 'a' } })
      fireEvent.change(searchInput, { target: { value: 'ab' } })
      fireEvent.change(searchInput, { target: { value: 'abc' } })

      // Assert
      expect(onFilterChange).toHaveBeenCalledTimes(3)
      expect(onFilterChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ searchQuery: 'abc' }),
      )
    })

    it('should handle special characters in search', () => {
      // Arrange
      const onFilterChange = vi.fn()
      render(<FilterManagement onFilterChange={onFilterChange} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('plugin.search'), {
        target: { value: '!@#$%^&*()' },
      })

      // Assert
      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ searchQuery: '!@#$%^&*()' }),
      )
    })
  })
})
