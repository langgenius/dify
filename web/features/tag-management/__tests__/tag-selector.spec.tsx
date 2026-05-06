import type { Tag } from '@/contract/console/tags'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagSelector } from '../components/tag-selector'

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

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: mockToast,
}))

const { mockUseQueryData, createTag, bindTag, unBindTag } = vi.hoisted(() => ({
  mockUseQueryData: { current: [] as Tag[] },
  createTag: vi.fn(),
  bindTag: vi.fn(),
  unBindTag: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockUseQueryData.current }),
}))

vi.mock('../hooks/use-tag-mutations', () => ({
  useCreateTagMutation: () => ({
    isPending: false,
    mutate: ({ body }: { body: { name: string, type: 'app' | 'knowledge' } }, options?: { onSuccess?: (tag: Tag) => void, onError?: () => void }) => {
      try {
        const tag = { id: 'new-tag', name: body.name, type: body.type, binding_count: 0 } as Tag
        createTag(body.name, body.type)
        options?.onSuccess?.(tag)
      }
      catch {
        options?.onError?.()
      }
    },
  }),
  useApplyTagBindingsMutation: () => ({
    mutate: (
      { currentTagIds, nextTagIds, targetId, type }: { currentTagIds: string[], nextTagIds: string[], targetId: string, type: 'app' | 'knowledge' },
      options?: { onSuccess?: () => void, onError?: () => void, onSettled?: () => void },
    ) => {
      const addTagIds = nextTagIds.filter(tagId => !currentTagIds.includes(tagId))
      const removeTagIds = currentTagIds.filter(tagId => !nextTagIds.includes(tagId))
      const operations: Promise<unknown>[] = []

      if (addTagIds.length)
        operations.push(Promise.resolve(bindTag(addTagIds, targetId, type)))
      operations.push(...removeTagIds.map(tagId => Promise.resolve(unBindTag(tagId, targetId, type))))

      Promise.all(operations)
        .then(() => options?.onSuccess?.())
        .catch(() => options?.onError?.())
        .finally(() => options?.onSettled?.())
    },
  }),
}))

// i18n keys rendered in "ns.key" format
const i18n = {
  addTag: 'common.tag.addTag',
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  manageTags: 'common.tag.manageTags',
  noTag: 'common.tag.noTag',
  modifiedSuccessfully: 'common.actionMsg.modifiedSuccessfully',
  modifiedUnsuccessfully: 'common.actionMsg.modifiedUnsuccessfully',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
]

const defaultProps = {
  targetId: 'target-1',
  type: 'app' as const,
  selectedTagIds: ['tag-1'!],
  selectedTags: [appTags[0]!],
}

describe('TagSelector', () => {
  const getPanelTagRow = (tagName: string) => {
    const row = screen.getAllByTestId('tag-row').find(tagRow => within(tagRow).queryByText(tagName))
    expect(row).toBeDefined()
    return row as HTMLElement
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryData.current = appTags
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
    vi.mocked(bindTag).mockResolvedValue(undefined)
    vi.mocked(unBindTag).mockResolvedValue(undefined)
  })

  describe('Rendering', () => {
    it('should render TagSelector trigger with selected tag names from defaultProps when isPopover defaults to true', () => {
      render(<TagSelector {...defaultProps} />)
      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
    })

    it('should render TagSelector add-tag placeholder when defaultProps are overridden with empty selectedTags and value', () => {
      render(<TagSelector {...defaultProps} selectedTags={[]} selectedTagIds={[]} />)
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
          selectedTagIds={['tag-1', 'unknown']}
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
          selectedTagIds={['tag-1', 'tag-2']}
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
      mockUseQueryData.current = []
      render(<TagSelector {...defaultProps} selectedTags={[]} selectedTagIds={[]} />)

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText(i18n.noTag))!.toBeInTheDocument()
      })
    })

    it('should bind a newly selected tag when closing the panel', async () => {
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
      })
    })

    it('should show one success toast when tag bindings are applied on close', async () => {
      const user = userEvent.setup()
      render(<TagSelector {...defaultProps} />)

      const triggerButton = screen.getByRole('button', { name: /Frontend/i })
      await user.click(triggerButton)

      await screen.findByPlaceholderText(i18n.selectorPlaceholder)
      await user.click(getPanelTagRow('Backend'))
      await user.click(triggerButton)

      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalledWith(i18n.modifiedSuccessfully, {
          id: 'tag-bindings-app-target-1',
        })
      })
    })

    it('should unbind a deselected tag when closing the panel', async () => {
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
      })
    })

    it('should show one error toast when applying tag bindings fails on close', async () => {
      const user = userEvent.setup()
      vi.mocked(unBindTag).mockRejectedValueOnce(new Error('Unbind failed'))
      render(<TagSelector {...defaultProps} />)

      const triggerButton = screen.getByRole('button', { name: /Frontend/i })
      await user.click(triggerButton)

      await screen.findByPlaceholderText(i18n.selectorPlaceholder)
      await user.click(getPanelTagRow('Frontend'))
      await user.click(triggerButton)

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(i18n.modifiedUnsuccessfully, {
          id: 'tag-bindings-app-target-1',
        })
      })
    })

    it('should not apply bindings when the selection is unchanged on close', async () => {
      const user = userEvent.setup()
      const onTagsChange = vi.fn()
      render(<TagSelector {...defaultProps} onTagsChange={onTagsChange} />)

      const triggerButton = screen.getByRole('button', { name: /Frontend/i })
      await user.click(triggerButton)
      await screen.findByPlaceholderText(i18n.selectorPlaceholder)
      await user.click(triggerButton)

      expect(bindTag).not.toHaveBeenCalled()
      expect(unBindTag).not.toHaveBeenCalled()
      expect(mockToast.success).not.toHaveBeenCalled()
      expect(mockToast.error).not.toHaveBeenCalled()
      expect(onTagsChange).not.toHaveBeenCalled()
    })

    it('should notify tag changes after bindings are applied successfully', async () => {
      const user = userEvent.setup()
      const onTagsChange = vi.fn()
      render(<TagSelector {...defaultProps} onTagsChange={onTagsChange} />)

      const triggerButton = screen.getByRole('button', { name: /Frontend/i })
      await user.click(triggerButton)

      await screen.findByPlaceholderText(i18n.selectorPlaceholder)
      await user.click(getPanelTagRow('Backend'))
      await user.click(triggerButton)

      await waitFor(() => {
        expect(onTagsChange).toHaveBeenCalledTimes(1)
      })
    })

    it('should notify tag changes after applying bindings settles with an error', async () => {
      const user = userEvent.setup()
      const onTagsChange = vi.fn()
      vi.mocked(unBindTag).mockRejectedValueOnce(new Error('Unbind failed'))
      render(<TagSelector {...defaultProps} onTagsChange={onTagsChange} />)

      const triggerButton = screen.getByRole('button', { name: /Frontend/i })
      await user.click(triggerButton)

      await screen.findByPlaceholderText(i18n.selectorPlaceholder)
      await user.click(getPanelTagRow('Frontend'))
      await user.click(triggerButton)

      await waitFor(() => {
        expect(onTagsChange).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Data Fetching', () => {
    it('should create tags through the mutation hook', async () => {
      const user = userEvent.setup()
      vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 })

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

      expect(mockUseQueryData.current).toEqual(appTags)
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
          selectedTagIds={['orphan-1']}
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
      mockUseQueryData.current = knowledgeTags

      render(
        <TagSelector
          {...defaultProps}
          type="knowledge"
          selectedTags={knowledgeTags}
          selectedTagIds={['k-1']}
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
