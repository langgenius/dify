import type { Tag } from '@/app/components/base/tag-management/constant'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import TagSelector from '../selector'
import { useStore as useTagStore } from '../store'

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: mockToast,
}))

// Hoisted mocks
const { fetchTagList, createTag, bindTag, unBindTag } = vi.hoisted(() => ({
  fetchTagList: vi.fn(),
  createTag: vi.fn(),
  bindTag: vi.fn(),
  unBindTag: vi.fn(),
}))

vi.mock('@/service/tag', () => ({
  fetchTagList,
  createTag,
  bindTag,
  unBindTag,
}))

// i18n keys rendered in "ns.key" format
const i18n = {
  addTag: 'common.tag.addTag',
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  manageTags: 'common.tag.manageTags',
  noTag: 'common.tag.noTag',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
]

const defaultProps = {
  targetID: 'target-1',
  type: 'app' as const,
  value: ['tag-1'!],
  selectedTags: [appTags[0]!],
  onCacheUpdate: vi.fn(),
  onChange: vi.fn(),
}

describe('TagSelector', () => {
  const getPanelTagRow = (tagName: string) => {
    const row = screen.getAllByTestId('tag-row').find(tagRow => within(tagRow).queryByText(tagName))
    expect(row).toBeDefined()
    return row as HTMLElement
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchTagList).mockResolvedValue(appTags)
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
    vi.mocked(bindTag).mockResolvedValue(undefined)
    vi.mocked(unBindTag).mockResolvedValue(undefined)
    act(() => {
      useTagStore.setState({ tagList: appTags, showTagManagementModal: false })
    })
  })

  describe('Rendering', () => {
    it('should render TagSelector trigger with selected tag names from defaultProps when isPopover defaults to true', () => {
      render(<TagSelector {...defaultProps} />)
      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
    })

    it('should render TagSelector add-tag placeholder when defaultProps are overridden with empty selectedTags and value', () => {
      render(<TagSelector {...defaultProps} selectedTags={[]} value={[]} />)
      expect(screen.getByText(i18n.addTag))!.toBeInTheDocument()
    })

    it('should render nothing when isPopover is false', () => {
      const { container } = render(<TagSelector {...defaultProps} isPopover={false} />)
      // Only the empty fragment wrapper
      // Only the empty fragment wrapper
      expect(container)!.toBeEmptyDOMElement()
    })

    it('should render the popover trigger button', () => {
      render(<TagSelector {...defaultProps} />)
      // The trigger is wrapped in a PopoverButton
      // The trigger is wrapped in a PopoverButton
      expect(screen.getByRole('button'))!.toBeInTheDocument()
    })

    it('should render when minWidth is provided', () => {
      render(<TagSelector {...defaultProps} minWidth="320px" />)
      expect(screen.getByRole('button'))!.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should filter selectedTags to only those present in store tagList', () => {
      const unknownTag: Tag = { id: 'unknown', name: 'Unknown', type: 'app', binding_count: 0 }
      render(
        <TagSelector
          {...defaultProps}
          selectedTags={[appTags[0]!, unknownTag]}
          value={['tag-1', 'unknown']}
        />,
      )
      // 'Frontend' is in tagList, 'Unknown' is not
      // 'Frontend' is in tagList, 'Unknown' is not
      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    })

    it('should display multiple tag names when multiple are selected', () => {
      render(
        <TagSelector
          {...defaultProps}
          selectedTags={appTags}
          value={['tag-1', 'tag-2']}
        />,
      )
      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
      expect(screen.getByText('Backend'))!.toBeInTheDocument()
    })
  })

  describe('Popover Interaction', () => {
    it('should show the panel when the trigger is clicked', async () => {
      const user = userEvent.setup()
      render(<TagSelector {...defaultProps} />)

      await user.click(screen.getByRole('button'))

      // Panel renders the search input and manage tags
      await waitFor(() => {
        expect(screen.getByPlaceholderText(i18n.selectorPlaceholder))!.toBeInTheDocument()
        expect(screen.getByText(i18n.manageTags))!.toBeInTheDocument()
      })
    })

    it('should show unselected tags in the panel', async () => {
      const user = userEvent.setup()
      render(<TagSelector {...defaultProps} />)

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('Backend'))!.toBeInTheDocument()
      })
    })

    it('should show the no-tag message when tag list is empty', async () => {
      const user = userEvent.setup()
      act(() => {
        useTagStore.setState({ tagList: [] })
      })
      render(<TagSelector {...defaultProps} selectedTags={[]} value={[]} />)

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText(i18n.noTag))!.toBeInTheDocument()
      })
    })

    it('should bind a newly selected tag and update cache when closing the panel', async () => {
      const user = userEvent.setup()
      render(<TagSelector {...defaultProps} />)

      const triggerButton = screen.getByRole('button', { name: /Frontend/i })
      await user.click(triggerButton)

      await screen.findByPlaceholderText(i18n.selectorPlaceholder)
      await user.click(getPanelTagRow('Backend'))

      // Close panel to trigger unmount side effects.
      await user.click(triggerButton)

      await waitFor(() => {
        expect(bindTag).toHaveBeenCalledTimes(1)
        expect(bindTag).toHaveBeenCalledWith(['tag-2'], 'target-1', 'app')
        expect(defaultProps.onCacheUpdate).toHaveBeenCalledTimes(1)
        expect(defaultProps.onCacheUpdate).toHaveBeenCalledWith(appTags)
      })
    })

    it('should unbind a deselected tag and update cache when closing the panel', async () => {
      const user = userEvent.setup()
      render(<TagSelector {...defaultProps} />)

      const triggerButton = screen.getByRole('button', { name: /Frontend/i })
      await user.click(triggerButton)

      await screen.findByPlaceholderText(i18n.selectorPlaceholder)
      await user.click(getPanelTagRow('Frontend'))

      // Close panel to trigger unmount side effects.
      await user.click(triggerButton)

      await waitFor(() => {
        expect(unBindTag).toHaveBeenCalledTimes(1)
        expect(unBindTag).toHaveBeenCalledWith('tag-1', 'target-1', 'app')
        expect(defaultProps.onCacheUpdate).toHaveBeenCalledTimes(1)
        expect(defaultProps.onCacheUpdate).toHaveBeenCalledWith([])
      })
    })
  })

  describe('Data Fetching (getTagList / onCreate)', () => {
    it('should update the store tagList after fetching', async () => {
      const user = userEvent.setup()
      const freshTags: Tag[] = [
        ...appTags,
        { id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 },
      ]
      vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 })
      vi.mocked(fetchTagList).mockResolvedValue(freshTags)

      render(<TagSelector {...defaultProps} />)

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText(i18n.selectorPlaceholder))!.toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = await screen.findByTestId('create-tag-option')
      await user.click(createOption)

      await waitFor(() => {
        expect(createTag).toHaveBeenCalledWith('BrandNewTag', 'app')
      })

      await waitFor(() => {
        expect(fetchTagList).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(useTagStore.getState().tagList).toEqual(freshTags)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle selectedTags with no matching tags in store', () => {
      const orphanTags: Tag[] = [
        { id: 'orphan-1', name: 'Orphan', type: 'app', binding_count: 0 },
      ]
      render(
        <TagSelector
          {...defaultProps}
          selectedTags={orphanTags}
          value={['orphan-1']}
        />,
      )
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      // Orphan tag is not in store tagList, so tags memo returns []
      expect(screen.queryByText('Orphan')).not.toBeInTheDocument()
      expect(screen.getByText(i18n.addTag))!.toBeInTheDocument()
    })

    it('should handle knowledge type', async () => {
      const user = userEvent.setup()
      const knowledgeTags: Tag[] = [
        { id: 'k-1', name: 'KnowledgeDB', type: 'knowledge', binding_count: 2 },
      ]
      vi.mocked(fetchTagList).mockResolvedValue(knowledgeTags)
      act(() => {
        useTagStore.setState({ tagList: knowledgeTags })
      })

      render(
        <TagSelector
          {...defaultProps}
          type="knowledge"
          selectedTags={knowledgeTags}
          value={['k-1']}
        />,
      )

      expect(screen.getByText('KnowledgeDB'))!.toBeInTheDocument()

      // Open popover and verify panel uses knowledge type
      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText(i18n.selectorPlaceholder))!.toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'NewKnowledgeTag')

      const createOption = await screen.findByTestId('create-tag-option')
      await user.click(createOption)

      await waitFor(() => {
        expect(createTag).toHaveBeenCalledWith('NewKnowledgeTag', 'knowledge')
      })
    })
  })
})
