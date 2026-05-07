import type { Tag } from '@/contract/console/tags'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagFilter } from '../components/tag-filter'

const { mockUseQueryData } = vi.hoisted(() => ({
  mockUseQueryData: { current: [] as Tag[] },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockUseQueryData.current }),
}))

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
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  operationClear: 'common.operation.clear',
  noTag: 'common.tag.noTag',
  manageTags: 'common.tag.manageTags',
}

describe('TagFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryData.current = mockTags
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
      const tagItem = screen.getByRole('option', { name: /Frontend/i })
      expect(tagItem).toBeInTheDocument()
      expect(tagItem).toHaveAttribute('aria-selected', 'true')
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
      const onOpenTagManagement = vi.fn()
      render(<TagFilter {...defaultProps} onOpenTagManagement={onOpenTagManagement} />)

      await user.click(screen.getByText(i18n.placeholder))
      await user.click(screen.getByText(i18n.manageTags))

      expect(onOpenTagManagement).toHaveBeenCalledTimes(1)
    })
  })

  describe('Search', () => {
    it('should filter tags by search keywords', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
      await user.type(searchInput, 'Front')

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.queryByText('Backend')).not.toBeInTheDocument()
      expect(screen.queryByText('API Design')).not.toBeInTheDocument()
    })

    it('should show no tags message when search has no results', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
      await user.type(searchInput, 'NonExistentTag')

      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    })

    it('should clear search and show all tags when clear icon is clicked', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
      await user.type(searchInput, 'Front')

      expect(screen.queryByText('Backend')).not.toBeInTheDocument()

      const clearButton = screen.getByRole('button', { name: i18n.operationClear })
      await user.click(clearButton)

      expect(searchInput).toHaveValue('')

      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('API Design')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should show no tag message when tag list is completely empty', async () => {
      const user = userEvent.setup()
      mockUseQueryData.current = []

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
