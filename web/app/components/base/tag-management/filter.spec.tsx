import type { Tag } from '@/app/components/base/tag-management/constant'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import * as React from 'react'
import TagFilter from './filter'
import { useStore as useTagStore } from './store'

const { fetchTagList } = vi.hoisted(() => ({
  fetchTagList: vi.fn(),
}))
// Mock the tag service (API layer)
vi.mock('@/service/tag', () => ({
  fetchTagList,
}))

// Mock ahooks to avoid timer-related issues in tests
vi.mock('ahooks', () => {
  return {
    useDebounceFn: (fn: (...args: unknown[]) => void) => {
      const ref = React.useRef(fn)
      ref.current = fn
      const stableRun = React.useRef((...args: unknown[]) => {
        // Schedule to run after current event handler finishes,
        // allowing React to process pending state updates first
        Promise.resolve().then(() => ref.current(...args))
      })
      return { run: stableRun.current }
    },
    useMount: (fn: () => void) => {
      React.useEffect(() => {
        fn()
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
    },
  }
})

const mockTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
  { id: 'tag-3', name: 'Database', type: 'knowledge', binding_count: 2 },
  { id: 'tag-4', name: 'API Design', type: 'app', binding_count: 1 },
]

const defaultProps = {
  type: 'app' as const,
  value: [] as string[],
  onChange: vi.fn(),
}

// Helper: the i18n mock renders "ns.key" format (dot-separated)
const i18n = {
  placeholder: 'common.tag.placeholder',
  noTag: 'common.tag.noTag',
  manageTags: 'common.tag.manageTags',
}

describe('TagFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchTagList).mockResolvedValue(mockTags)
    // Pre-populate the Zustand store with tags so dropdown content is available
    act(() => {
      useTagStore.setState({ tagList: mockTags, showTagManagementModal: false })
    })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TagFilter {...defaultProps} />)
      expect(screen.getByText(i18n.placeholder)).toBeInTheDocument()
    })

    it('should render the tag icon', () => {
      render(<TagFilter {...defaultProps} />)
      expect(screen.getByTestId('tag-filter-trigger-icon')).toBeInTheDocument()
    })

    it('should render the arrow down icon when no tags are selected', () => {
      render(<TagFilter {...defaultProps} />)
      expect(screen.getByText(i18n.placeholder)).toBeInTheDocument()
      expect(screen.getByTestId('tag-filter-trigger-icon')).toBeInTheDocument()
      expect(screen.getByTestId('tag-filter-arrow-down-icon')).toBeInTheDocument()
    })

    it('should display the first selected tag name when tags are selected', () => {
      render(<TagFilter {...defaultProps} value={['tag-1']} />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should display the count badge when multiple tags are selected', () => {
      render(<TagFilter {...defaultProps} value={['tag-1', 'tag-2']} />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
    })

    it('should display correct count badge for three selected tags', () => {
      render(<TagFilter {...defaultProps} value={['tag-1', 'tag-2', 'tag-4']} />)
      expect(screen.getByText('+2')).toBeInTheDocument()
    })

    it('should not show placeholder when tags are selected', () => {
      render(<TagFilter {...defaultProps} value={['tag-1']} />)
      expect(screen.queryByText(i18n.placeholder)).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should filter tags by type prop', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} type="knowledge" />)

      await user.click(screen.getByText(i18n.placeholder))

      // Only knowledge-type tags should appear
      expect(screen.getByText('Database')).toBeInTheDocument()
      expect(screen.queryByText('Frontend')).not.toBeInTheDocument()
      expect(screen.queryByText('Backend')).not.toBeInTheDocument()
    })

    it('should call onChange when a tag is selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} onChange={onChange} />)

      await user.click(screen.getByText(i18n.placeholder))
      await user.click(screen.getByText('Frontend'))

      expect(onChange).toHaveBeenCalledWith(['tag-1'])
    })

    it('should call onChange to deselect when an already-selected tag is clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} value={['tag-1']} onChange={onChange} />)

      // Open dropdown — trigger shows the tag name "Frontend"
      await user.click(screen.getByText('Frontend'))
      // Click the tag in the dropdown (it has a title attribute)
      await user.click(screen.getByTitle('Frontend'))

      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('User Interactions', () => {
    it('should open dropdown on trigger click', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      // Dropdown content should appear with tags
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('API Design')).toBeInTheDocument()
    })

    it('should show only tags matching the type filter', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} type="app" />)

      await user.click(screen.getByText(i18n.placeholder))

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('API Design')).toBeInTheDocument()
      expect(screen.queryByText('Database')).not.toBeInTheDocument()
    })

    it('should add a tag to the selection', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} value={['tag-1']} onChange={onChange} />)

      await user.click(screen.getByText('Frontend'))
      await user.click(screen.getByTitle('Backend'))

      expect(onChange).toHaveBeenCalledWith(['tag-1', 'tag-2'])
    })

    it('should show check icon for selected tags in dropdown', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} value={['tag-1']} />)

      await user.click(screen.getByText('Frontend'))

      // The Check icon should be rendered for the selected tag
      const tagItem = screen.getByTitle('Frontend')
      expect(tagItem).toBeInTheDocument()
      // The parent container of the tag has a Check SVG sibling
      const checkIcons = screen.getAllByTestId('tag-filter-selected-icon')
      expect(checkIcons?.length).toBeGreaterThanOrEqual(1)
    })

    it('should clear all selected tags when clear button is clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} value={['tag-1', 'tag-2']} onChange={onChange} />)

      const clearButton = screen.getByTestId('tag-filter-clear-button')
      expect(clearButton).toBeInTheDocument()
      await user.click(clearButton!)

      expect(onChange).toHaveBeenCalledWith([])
    })

    it('should open manage tags modal and close dropdown', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))
      await user.click(screen.getByText(i18n.manageTags))

      expect(useTagStore.getState().showTagManagementModal).toBe(true)
    })
  })

  describe('Search', () => {
    it('should filter tags by search keywords', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('textbox')
      await user.type(searchInput, 'Front')

      // With debounce mocked to be synchronous, results should be immediate
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.queryByText('Backend')).not.toBeInTheDocument()
      expect(screen.queryByText('API Design')).not.toBeInTheDocument()
    })

    it('should show no tags message when search has no results', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('textbox')
      await user.type(searchInput, 'NonExistentTag')

      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    })

    it('should clear search and show all tags when clear icon is clicked', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('textbox')
      await user.type(searchInput, 'Front')

      // Wait for the debounced search to filter
      await waitFor(() => {
        expect(screen.queryByText('Backend')).not.toBeInTheDocument()
      })

      // Clear the search using the Input's clear button
      const clearButton = screen.getByTestId('input-clear')
      await user.click(clearButton)

      // The input value should be cleared
      expect(searchInput).toHaveValue('')

      // After the clear + microtask re-render, all app tags should be visible again
      await waitFor(() => {
        expect(screen.getByText('Backend')).toBeInTheDocument()
      })
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('API Design')).toBeInTheDocument()
    })
  })

  describe('Data Fetching', () => {
    it('should fetch tag list on mount', () => {
      render(<TagFilter {...defaultProps} />)
      expect(fetchTagList).toHaveBeenCalledWith('app')
    })

    it('should fetch with correct type parameter', () => {
      render(<TagFilter {...defaultProps} type="knowledge" />)
      expect(fetchTagList).toHaveBeenCalledWith('knowledge')
    })

    it('should update the store with fetched tags', async () => {
      const freshTags: Tag[] = [
        { id: 'new-1', name: 'NewTag', type: 'app', binding_count: 0 },
      ]
      vi.mocked(fetchTagList).mockResolvedValue(freshTags)
      act(() => {
        useTagStore.setState({ tagList: [] })
      })

      render(<TagFilter {...defaultProps} />)

      await waitFor(() => {
        expect(useTagStore.getState().tagList).toEqual(freshTags)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should show no tag message when tag list is completely empty', async () => {
      const user = userEvent.setup()
      // Mock fetchTagList to return empty so useMount doesn't repopulate
      vi.mocked(fetchTagList).mockResolvedValue([])
      act(() => {
        useTagStore.setState({ tagList: [] })
      })

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    })

    it('should handle value with non-existent tag ids gracefully', () => {
      render(<TagFilter {...defaultProps} value={['non-existent-id']} />)
      expect(screen.queryByText(i18n.placeholder)).not.toBeInTheDocument()
    })

    it('should not show count badge when only one tag is selected', () => {
      render(<TagFilter {...defaultProps} value={['tag-1']} />)
      expect(screen.queryByText(/\+\d/)).not.toBeInTheDocument()
    })

    it('should clear selection without opening dropdown', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} value={['tag-1']} onChange={onChange} />)

      const clearButton = screen.getByTestId('tag-filter-clear-button')
      expect(clearButton).toBeInTheDocument()

      await user.click(clearButton)
      expect(onChange).toHaveBeenCalledWith([])
    })
  })
})
