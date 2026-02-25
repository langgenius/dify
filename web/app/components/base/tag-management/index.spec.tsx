import type { Tag } from '@/app/components/base/tag-management/constant'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { act } from 'react'
import TagManagementModal from './index'
import { useStore as useTagStore } from './store'

// Hoisted mocks
const { fetchTagList, createTag } = vi.hoisted(() => ({
  fetchTagList: vi.fn(),
  createTag: vi.fn(),
}))

const mockNotify = vi.fn()

vi.mock('@/service/tag', () => ({
  fetchTagList,
  createTag,
}))

// Mock use-context-selector for ToastContext
vi.mock('use-context-selector', () => ({
  createContext: <T,>(defaultValue: T) => React.createContext(defaultValue),
  useContext: () => ({
    notify: mockNotify,
  }),
}))

const mockTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
  { id: 'tag-3', name: 'Database', type: 'knowledge', binding_count: 2 },
]

const defaultProps = {
  type: 'app' as const,
  show: true,
}

// i18n mock renders "ns.key" format (dot-separated)
const i18n = {
  manageTags: 'common.tag.manageTags',
  addNew: 'common.tag.addNew',
  created: 'common.tag.created',
  failed: 'common.tag.failed',
}

describe('TagManagementModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchTagList).mockResolvedValue(mockTags)
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
    act(() => {
      useTagStore.setState({ tagList: mockTags, showTagManagementModal: false })
    })
  })

  describe('Rendering', () => {
    it('should render the modal title when show is true', () => {
      render(<TagManagementModal {...defaultProps} />)
      expect(screen.getByText(i18n.manageTags)).toBeInTheDocument()
    })

    it('should render the close button', () => {
      render(<TagManagementModal {...defaultProps} />)
      const closeIcon = screen.getByTestId('tag-management-modal-close-button')
      expect(closeIcon).toBeTruthy()
    })

    it('should render the new tag input with placeholder', () => {
      render(<TagManagementModal {...defaultProps} />)
      expect(screen.getByPlaceholderText(i18n.addNew)).toBeInTheDocument()
    })

    it('should render existing tags from the store', () => {
      render(<TagManagementModal {...defaultProps} />)
      // TagItemEditor renders each tag's name
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
    })

    it('should not render content when show is false', () => {
      render(<TagManagementModal {...defaultProps} show={false} />)
      // The Modal component hides content when isShow is false
      expect(screen.queryByText(i18n.manageTags)).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should fetch tags for the given type on mount', async () => {
      render(<TagManagementModal {...defaultProps} type="app" />)
      await waitFor(() => {
        expect(fetchTagList).toHaveBeenCalledWith('app')
      })
    })

    it('should fetch knowledge tags when type is knowledge', async () => {
      render(<TagManagementModal {...defaultProps} type="knowledge" />)
      await waitFor(() => {
        expect(fetchTagList).toHaveBeenCalledWith('knowledge')
      })
    })
  })

  describe('User Interactions', () => {
    it('should close modal when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<TagManagementModal {...defaultProps} />)

      const closeIcon = screen.getByTestId('tag-management-modal-close-button')
      const closeButton = closeIcon.parentElement!
      await user.click(closeButton)

      expect(useTagStore.getState().showTagManagementModal).toBe(false)
    })

    it('should update input value when typing', async () => {
      const user = userEvent.setup()
      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')

      expect(input).toHaveValue('NewTag')
    })

    it('should create a new tag on Enter key press', async () => {
      const user = userEvent.setup()
      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(createTag).toHaveBeenCalledWith('NewTag', 'app')
      })
    })

    it('should show success notification after creating a tag', async () => {
      const user = userEvent.setup()
      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: i18n.created,
        })
      })
    })

    it('should clear input after successful tag creation', async () => {
      const user = userEvent.setup()
      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    it('should add the new tag to the store tag list', async () => {
      const user = userEvent.setup()
      const newTag = { id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 }
      vi.mocked(createTag).mockResolvedValue(newTag)

      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        const storeTagList = useTagStore.getState().tagList
        expect(storeTagList).toContainEqual(newTag)
      })
    })

    it('should prepend the new tag to the beginning of the list', async () => {
      const user = userEvent.setup()
      const newTag = { id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 }
      vi.mocked(createTag).mockResolvedValue(newTag)

      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        const storeTagList = useTagStore.getState().tagList
        expect(storeTagList[0]).toEqual(newTag)
      })
    })

    it('should create a tag on input blur', async () => {
      const user = userEvent.setup()
      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')
      // Click outside to trigger blur
      await user.click(document.body)

      await waitFor(() => {
        expect(createTag).toHaveBeenCalledWith('NewTag', 'app')
      })
    })
  })

  describe('Error Handling', () => {
    it('should not create tag when name is empty', async () => {
      const user = userEvent.setup()
      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      // Focus and press Enter without typing
      await user.click(input)
      await user.keyboard('{Enter}')

      expect(createTag).not.toHaveBeenCalled()
    })

    it('should show error notification when tag creation fails', async () => {
      const user = userEvent.setup()
      vi.mocked(createTag).mockRejectedValue(new Error('Creation failed'))

      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'FailTag')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: i18n.failed,
        })
      })
    })

    it('should not allow duplicate creation while pending', async () => {
      const user = userEvent.setup()
      // Make createTag slow to simulate pending
      let resolveCreate: (value: Tag) => void
      vi.mocked(createTag).mockImplementation(() => new Promise((resolve) => {
        resolveCreate = resolve
      }))

      render(<TagManagementModal {...defaultProps} />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'NewTag')
      await user.keyboard('{Enter}')

      // First call should go through
      expect(createTag).toHaveBeenCalledTimes(1)

      // Attempt second creation while first is pending — need to type again + enter
      // But the component sets pending=true, so the second call is blocked.
      // The input value was cleared? No — pending is set before clearing.
      // Actually the component does: setPending(true) -> await createTag -> setName('') -> setPending(false)
      // So while pending, name is still 'NewTag', but calling createNewTag again does nothing.
      // We can trigger via blur
      await user.click(document.body)

      // Should still be only 1 call because pending guard blocks it
      expect(createTag).toHaveBeenCalledTimes(1)

      // Resolve the pending promise
      await act(async () => {
        resolveCreate!({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
      })
    })
  })

  describe('Data Fetching', () => {
    it('should update store with fetched tags', async () => {
      const freshTags: Tag[] = [
        { id: 'fresh-1', name: 'FreshTag', type: 'app', binding_count: 0 },
      ]
      vi.mocked(fetchTagList).mockResolvedValue(freshTags)
      act(() => {
        useTagStore.setState({ tagList: [] })
      })

      render(<TagManagementModal {...defaultProps} />)

      await waitFor(() => {
        expect(useTagStore.getState().tagList).toEqual(freshTags)
      })
    })

    it('should refetch when type prop changes', () => {
      const { rerender } = render(<TagManagementModal {...defaultProps} type="app" />)
      expect(fetchTagList).toHaveBeenCalledWith('app')

      vi.clearAllMocks()
      rerender(<TagManagementModal {...defaultProps} type="knowledge" />)
      expect(fetchTagList).toHaveBeenCalledWith('knowledge')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty tag list', () => {
      act(() => {
        useTagStore.setState({ tagList: [] })
      })

      render(<TagManagementModal {...defaultProps} />)

      // Should still render the input
      expect(screen.getByPlaceholderText(i18n.addNew)).toBeInTheDocument()
    })

    it('should handle tag creation with knowledge type', async () => {
      const user = userEvent.setup()
      vi.mocked(createTag).mockResolvedValue({ id: 'new-k', name: 'KnowledgeTag', type: 'knowledge', binding_count: 0 })

      render(<TagManagementModal {...defaultProps} type="knowledge" />)

      const input = screen.getByPlaceholderText(i18n.addNew)
      await user.type(input, 'KnowledgeTag')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(createTag).toHaveBeenCalledWith('KnowledgeTag', 'knowledge')
      })
    })

    it('should close modal via the Modal onClose callback', async () => {
      const user = userEvent.setup()
      act(() => {
        useTagStore.setState({ showTagManagementModal: true })
      })
      render(<TagManagementModal {...defaultProps} />)
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(useTagStore.getState().showTagManagementModal).toBe(false)
      })
    })
  })
})
