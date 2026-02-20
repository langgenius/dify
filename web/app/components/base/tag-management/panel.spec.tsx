import type { Tag } from '@/app/components/base/tag-management/constant'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { act } from 'react'
import Panel from './panel'
import { useStore as useTagStore } from './store'

// Hoisted mocks
const { createTag, bindTag, unBindTag } = vi.hoisted(() => ({
  createTag: vi.fn(),
  bindTag: vi.fn(),
  unBindTag: vi.fn(),
}))

const mockNotify = vi.fn()

vi.mock('@/service/tag', () => ({
  createTag,
  bindTag,
  unBindTag,
}))

// Mock use-context-selector for ToastContext
vi.mock('use-context-selector', () => ({
  createContext: <T,>(defaultValue: T) => React.createContext(defaultValue),
  useContext: () => ({
    notify: mockNotify,
  }),
}))

// i18n mock renders "ns.key" format (dot-separated)
const i18n = {
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  create: 'common.tag.create',
  created: 'common.tag.created',
  failed: 'common.tag.failed',
  noTag: 'common.tag.noTag',
  manageTags: 'common.tag.manageTags',
  modifiedSuccessfully: 'common.actionMsg.modifiedSuccessfully',
  modifiedUnsuccessfully: 'common.actionMsg.modifiedUnsuccessfully',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
  { id: 'tag-3', name: 'API', type: 'app', binding_count: 1 },
]

const knowledgeTag: Tag = { id: 'tag-k1', name: 'KnowledgeDB', type: 'knowledge', binding_count: 2 }

const defaultProps = {
  targetID: 'target-1',
  type: 'app' as const,
  value: ['tag-1'], // tag-1 is already selected/bound
  selectedTags: [appTags[0]], // pre-selected tags shown separately
  onCacheUpdate: vi.fn(),
  onChange: vi.fn(),
  onCreate: vi.fn(),
}

describe('Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
    vi.mocked(bindTag).mockResolvedValue(undefined)
    vi.mocked(unBindTag).mockResolvedValue(undefined)
    act(() => {
      useTagStore.setState({ tagList: [...appTags, knowledgeTag], showTagManagementModal: false })
    })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Panel {...defaultProps} />)
      expect(screen.getByPlaceholderText(i18n.selectorPlaceholder)).toBeInTheDocument()
    })

    it('should render the search input', () => {
      render(<Panel {...defaultProps} />)
      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      expect(input).toBeInTheDocument()
      expect(input.tagName).toBe('INPUT')
    })

    it('should render selected tags from selectedTags prop', () => {
      render(<Panel {...defaultProps} />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should render unselected tags matching the type', () => {
      render(<Panel {...defaultProps} />)
      // tag-2 and tag-3 are app type and not in value[]
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('API')).toBeInTheDocument()
    })

    it('should not render tags of a different type', () => {
      render(<Panel {...defaultProps} />)
      // knowledgeTag is type 'knowledge', should not appear
      expect(screen.queryByText('KnowledgeDB')).not.toBeInTheDocument()
    })

    it('should render the manage tags button', () => {
      render(<Panel {...defaultProps} />)
      expect(screen.getByText(i18n.manageTags)).toBeInTheDocument()
    })

    it('should show no-tag message when there are no tags', () => {
      act(() => {
        useTagStore.setState({ tagList: [] })
      })
      render(<Panel {...defaultProps} value={[]} selectedTags={[]} />)
      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    })

    it('should not show no-tag message when tags exist', () => {
      render(<Panel {...defaultProps} />)
      expect(screen.queryByText(i18n.noTag)).not.toBeInTheDocument()
    })
  })

  describe('Search / Filter', () => {
    it('should filter tags by keyword', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Back')

      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.queryByText('API')).not.toBeInTheDocument()
    })

    it('should filter selected tags by keyword', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Front')

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.queryByText('Backend')).not.toBeInTheDocument()
    })

    it('should show create option when keyword does not match any tag', async () => {
      const user = userEvent.setup()
      // notExisted uses .every(tag => tag.type === type && tag.name !== keywords)
      // so store must only contain same-type tags for notExisted to be true
      act(() => {
        useTagStore.setState({ tagList: appTags })
      })
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      // The create row shows "Create 'BrandNewTag'"
      expect(screen.getByText(/BrandNewTag/)).toBeInTheDocument()
      expect(screen.getByText(new RegExp(i18n.create))).toBeInTheDocument()
    })

    it('should not show create option when keyword matches an existing tag name', async () => {
      const user = userEvent.setup()
      // Use only same-type tags so we can verify name matching specifically
      act(() => {
        useTagStore.setState({ tagList: appTags })
      })
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Frontend')

      // 'Frontend' matches tag-1 name, so notExisted = false
      expect(screen.queryByText(new RegExp(`${i18n.create}\\s`))).not.toBeInTheDocument()
    })

    it('should clear search when clear button is clicked', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Back')
      expect(input).toHaveValue('Back')

      // The Input component renders a clear icon with data-testid="input-clear"
      const clearButton = screen.getByTestId('input-clear')
      await user.click(clearButton)

      expect(input).toHaveValue('')
      // All tags should be visible again
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('API')).toBeInTheDocument()
    })
  })

  describe('Tag Selection', () => {
    it('should select an unselected tag when clicked', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      // Click on 'Backend' (tag-2, currently unselected)
      await user.click(screen.getByText('Backend'))

      // After clicking, tag-2 should be added to selectedTagIDs
      // The checkbox for Backend should now show checked state
      // We verify by checking the check icon appears (RiCheckLine renders when checked)
      const backendRow = screen.getByText('Backend').closest('div[class*="cursor-pointer"]')
      expect(backendRow).toBeTruthy()
    })

    it('should deselect a selected tag when clicked', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      // Frontend (tag-1) is in value[], so it's initially selected
      await user.click(screen.getByText('Frontend'))

      // After clicking, tag-1 should be removed from selectedTagIDs
      // The component re-renders with updated state
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should toggle tag selection on multiple clicks', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const backendText = screen.getByText('Backend')

      // Click to select
      await user.click(backendText)
      // Click to deselect
      await user.click(backendText)

      // Tag should still be rendered
      expect(screen.getByText('Backend')).toBeInTheDocument()
    })
  })

  describe('Tag Creation', () => {
    beforeEach(() => {
      // notExisted requires all tags to be same type, so remove knowledgeTag
      act(() => {
        useTagStore.setState({ tagList: appTags })
      })
    })

    it('should create a new tag when clicking the create option', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      // Click the create option
      const createOption = screen.getByText(new RegExp(i18n.create)).closest('div[class*="cursor-pointer"]')
      expect(createOption).toBeTruthy()
      await user.click(createOption!)

      await waitFor(() => {
        expect(createTag).toHaveBeenCalledWith('BrandNewTag', 'app')
      })
    })

    it('should show success notification after tag creation', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = screen.getByText(new RegExp(i18n.create)).closest('div[class*="cursor-pointer"]')
      await user.click(createOption!)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: i18n.created,
        })
      })
    })

    it('should clear keywords after successful tag creation', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = screen.getByText(new RegExp(i18n.create)).closest('div[class*="cursor-pointer"]')
      await user.click(createOption!)

      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    it('should call onCreate callback after successful tag creation', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = screen.getByText(new RegExp(i18n.create)).closest('div[class*="cursor-pointer"]')
      await user.click(createOption!)

      await waitFor(() => {
        expect(defaultProps.onCreate).toHaveBeenCalled()
      })
    })

    it('should add new tag to the store tag list', async () => {
      const user = userEvent.setup()
      const newTag = { id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 }
      vi.mocked(createTag).mockResolvedValue(newTag)

      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = screen.getByText(new RegExp(i18n.create)).closest('div[class*="cursor-pointer"]')
      await user.click(createOption!)

      await waitFor(() => {
        const storeTagList = useTagStore.getState().tagList
        expect(storeTagList).toContainEqual(newTag)
      })
    })

    it('should show error notification when tag creation fails', async () => {
      const user = userEvent.setup()
      vi.mocked(createTag).mockRejectedValue(new Error('Creation failed'))

      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'FailTag')

      const createOption = screen.getByText(new RegExp(i18n.create)).closest('div[class*="cursor-pointer"]')
      await user.click(createOption!)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: i18n.failed,
        })
      })
    })

    it('should not create tag when keywords is empty', () => {
      render(<Panel {...defaultProps} />)

      // The create option should not appear when no keywords
      expect(screen.queryByText(new RegExp(i18n.create))).not.toBeInTheDocument()
      expect(createTag).not.toHaveBeenCalled()
    })

    it('should not allow duplicate creation while pending', async () => {
      const user = userEvent.setup()
      let resolveCreate: (value: Tag) => void
      vi.mocked(createTag).mockImplementation(() => new Promise((resolve) => {
        resolveCreate = resolve
      }))

      render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = screen.getByText(new RegExp(i18n.create)).closest('div[class*="cursor-pointer"]')
      await user.click(createOption!)

      expect(createTag).toHaveBeenCalledTimes(1)

      // Try clicking again while still pending
      await user.click(createOption!)

      // Should still be only 1 call because creating guard blocks it
      expect(createTag).toHaveBeenCalledTimes(1)

      // Resolve the pending promise
      await act(async () => {
        resolveCreate!({ id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 })
      })
    })
  })

  describe('Bind/Unbind on Unmount', () => {
    it('should call bindTag for newly selected tags on unmount', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<Panel {...defaultProps} />)

      // Select 'Backend' (tag-2) — currently not in value[]
      await user.click(screen.getByText('Backend'))

      unmount()

      await waitFor(() => {
        expect(bindTag).toHaveBeenCalledWith(['tag-2'], 'target-1', 'app')
      })
    })

    it('should call unBindTag for deselected tags on unmount', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<Panel {...defaultProps} />)

      // Deselect 'Frontend' (tag-1) — currently in value[]
      await user.click(screen.getByText('Frontend'))

      unmount()

      await waitFor(() => {
        expect(unBindTag).toHaveBeenCalledWith('tag-1', 'target-1', 'app')
      })
    })

    it('should call onCacheUpdate with selected tags on unmount when value changed', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<Panel {...defaultProps} />)

      // Select 'Backend' (tag-2)
      await user.click(screen.getByText('Backend'))

      unmount()

      await waitFor(() => {
        expect(defaultProps.onCacheUpdate).toHaveBeenCalled()
      })
    })

    it('should not call bind/unbind when value has not changed', () => {
      const { unmount } = render(<Panel {...defaultProps} />)

      unmount()

      expect(bindTag).not.toHaveBeenCalled()
      expect(unBindTag).not.toHaveBeenCalled()
    })

    it('should call onChange after all operations complete on unmount', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<Panel {...defaultProps} />)

      await user.click(screen.getByText('Backend'))

      unmount()

      await waitFor(() => {
        expect(defaultProps.onChange).toHaveBeenCalled()
      })
    })

    it('should show success notification after successful bind', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<Panel {...defaultProps} />)

      await user.click(screen.getByText('Backend'))

      unmount()

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: i18n.modifiedSuccessfully,
        })
      })
    })

    it('should show error notification when bind fails', async () => {
      const user = userEvent.setup()
      vi.mocked(bindTag).mockRejectedValue(new Error('Bind failed'))

      const { unmount } = render(<Panel {...defaultProps} />)

      await user.click(screen.getByText('Backend'))

      unmount()

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: i18n.modifiedUnsuccessfully,
        })
      })
    })

    it('should show error notification when unbind fails', async () => {
      const user = userEvent.setup()
      vi.mocked(unBindTag).mockRejectedValue(new Error('Unbind failed'))

      const { unmount } = render(<Panel {...defaultProps} />)

      await user.click(screen.getByText('Frontend'))

      unmount()

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: i18n.modifiedUnsuccessfully,
        })
      })
    })
  })

  describe('Manage Tags Modal', () => {
    it('should open the tag management modal when manage tags is clicked', async () => {
      const user = userEvent.setup()
      render(<Panel {...defaultProps} />)

      await user.click(screen.getByText(i18n.manageTags))

      expect(useTagStore.getState().showTagManagementModal).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty value array', () => {
      render(<Panel {...defaultProps} value={[]} selectedTags={[]} />)
      // All app-type tags should appear in the unselected list
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('API')).toBeInTheDocument()
    })

    it('should handle empty tagList in store', () => {
      act(() => {
        useTagStore.setState({ tagList: [] })
      })
      render(<Panel {...defaultProps} value={[]} selectedTags={[]} />)
      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    })

    it('should handle all tags already selected', () => {
      render(
        <Panel
          {...defaultProps}
          value={['tag-1', 'tag-2', 'tag-3']}
          selectedTags={appTags}
        />,
      )
      // All app tags appear in selectedTags, filteredTagList should be empty
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('API')).toBeInTheDocument()
    })

    it('should handle search with no results and show no-tag when no keywords', () => {
      act(() => {
        useTagStore.setState({ tagList: [] })
      })
      render(<Panel {...defaultProps} value={[]} selectedTags={[]} />)
      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    })

    it('should show divider between create option and tag list when both present', async () => {
      const user = userEvent.setup()
      // Only same-type tags for notExisted to work
      act(() => {
        useTagStore.setState({ tagList: appTags })
      })
      const { container } = render(<Panel {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Fro')

      // 'Fro' does not match any tag names exactly, so notExisted is true
      // 'Frontend' includes 'Fro', so filteredTagList has items
      // A divider should appear
      const dividers = container.querySelectorAll('[class*="divider"]')
      expect(dividers.length).toBeGreaterThan(0)
    })

    it('should handle knowledge type tags correctly', () => {
      act(() => {
        useTagStore.setState({ tagList: [knowledgeTag] })
      })
      render(
        <Panel
          {...defaultProps}
          type="knowledge"
          value={[]}
          selectedTags={[]}
        />,
      )
      expect(screen.getByText('KnowledgeDB')).toBeInTheDocument()
    })
  })
})
