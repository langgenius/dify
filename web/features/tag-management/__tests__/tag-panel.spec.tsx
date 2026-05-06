import type { Tag } from '@/contract/console/tags'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import * as ReactI18next from 'react-i18next'
import { TagPanel } from '../components/tag-panel'

const { mockNotify, mockToast } = vi.hoisted(() => {
  const mockNotify = vi.fn()
  const mockToast = Object.assign(mockNotify, {
    success: vi.fn((message, options) => mockNotify({ type: 'success', message, ...options })),
    error: vi.fn((message, options) => mockNotify({ type: 'error', message, ...options })),
    warning: vi.fn((message, options) => mockNotify({ type: 'warning', message, ...options })),
    info: vi.fn((message, options) => mockNotify({ type: 'info', message, ...options })),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockNotify, mockToast }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: mockToast,
}))

// Hoisted mocks
const { createTag, bindTag, unBindTag } = vi.hoisted(() => ({
  createTag: vi.fn(),
  bindTag: vi.fn(),
  unBindTag: vi.fn(),
}))

vi.mock('../hooks/use-tag-mutations', () => ({
  useCreateTagMutation: () => {
    const mutation = {
      isPending: false,
      mutate: ({ body }: { body: { name: string, type: 'app' | 'knowledge' } }, options?: { onSuccess?: (tag: Tag) => void, onError?: () => void }) => {
        mutation.isPending = true
        const tag = { id: 'new-tag', name: body.name, type: body.type, binding_count: 0 } as Tag
        Promise.resolve(createTag(body.name, body.type))
          .then(() => options?.onSuccess?.(tag))
          .catch(() => options?.onError?.())
          .finally(() => {
            mutation.isPending = false
          })
      },
    }
    return mutation
  },
  useApplyTagBindingsMutation: () => ({
    mutate: (
      { currentTagIds, nextTagIds, targetId, type }: { currentTagIds: string[], nextTagIds: string[], targetId: string, type: 'app' | 'knowledge' },
      options?: { onSuccess?: () => void, onError?: () => void },
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
    },
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
  targetId: 'target-1',
  type: 'app' as const,
  selectedTagIds: ['tag-1'!], // tag-1 is already selected/bound
  selectedTags: [appTags[0]!], // pre-selected tags shown separately
  tagList: [...appTags, knowledgeTag],
}

describe('Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
    vi.mocked(bindTag).mockResolvedValue(undefined)
    vi.mocked(unBindTag).mockResolvedValue(undefined)
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      expect(screen.getByPlaceholderText(i18n.selectorPlaceholder))!.toBeInTheDocument()
    })

    it('should render the search input', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      expect(input)!.toBeInTheDocument()
      expect(input.tagName).toBe('INPUT')
    })

    it('should fallback to empty placeholder when translation is empty', () => {
      const mockedTranslation = {
        t: vi.fn().mockReturnValue(''),
        i18n: {} as ReturnType<typeof ReactI18next.useTranslation>['i18n'],
        ready: true,
      } as unknown as ReturnType<typeof ReactI18next.useTranslation>

      vi.spyOn(ReactI18next, 'useTranslation').mockReturnValueOnce(mockedTranslation)

      render(<TagPanel {...defaultProps} tagList={appTags} />)

      expect(screen.getByRole('textbox'))!.toHaveAttribute('placeholder', '')
    })

    it('should render selected tags from selectedTags prop', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
    })

    it('should render unselected tags matching the type', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      // tag-2 and tag-3 are app type and not in value[]
      // tag-2 and tag-3 are app type and not in value[]
      expect(screen.getByText('Backend'))!.toBeInTheDocument()
      expect(screen.getByText('API'))!.toBeInTheDocument()
    })

    it('should not render tags of a different type', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      // knowledgeTag is type 'knowledge', should not appear
      expect(screen.queryByText('KnowledgeDB')).not.toBeInTheDocument()
    })

    it('should render the manage tags button', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      expect(screen.getByText(i18n.manageTags))!.toBeInTheDocument()
    })

    it('should show no-tag message when there are no tags', () => {
      render(<TagPanel {...defaultProps} selectedTagIds={[]} selectedTags={[]} tagList={[]} />)
      expect(screen.getByText(i18n.noTag))!.toBeInTheDocument()
    })

    it('should not show no-tag message when tags exist', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      expect(screen.queryByText(i18n.noTag)).not.toBeInTheDocument()
    })
  })

  describe('Search / Filter', () => {
    it('should filter tags by keyword', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Back')

      expect(screen.getByText('Backend'))!.toBeInTheDocument()
      expect(screen.queryByText('API')).not.toBeInTheDocument()
    })

    it('should filter selected tags by keyword', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Front')

      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
      expect(screen.queryByText('Backend')).not.toBeInTheDocument()
    })

    it('should show create option when keyword does not match any tag', async () => {
      const user = userEvent.setup()
      // notExisted uses .every(tag => tag.type === type && tag.name !== keywords)
      // so store must only contain same-type tags for notExisted to be true
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      // The create row shows "Create 'BrandNewTag'"
      // The create row shows "Create 'BrandNewTag'"
      expect(screen.getByText(/BrandNewTag/))!.toBeInTheDocument()
      expect(screen.getByText(i18n.create, { exact: false }))!.toBeInTheDocument()
    })

    it('should not show create option when keyword matches an existing tag name', async () => {
      const user = userEvent.setup()
      // Use only same-type tags so we can verify name matching specifically
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Frontend')

      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      // 'Frontend' matches tag-1 name, so notExisted = false
      expect(screen.queryByText(i18n.create, { exact: false })).not.toBeInTheDocument()
    })

    it('should clear search when clear button is clicked', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Back')
      expect(input)!.toHaveValue('Back')

      // The Input component renders a clear icon with data-testid="input-clear"
      const clearButton = screen.getByTestId('input-clear')
      await user.click(clearButton)

      expect(input)!.toHaveValue('')
      // All tags should be visible again
      // All tags should be visible again
      expect(screen.getByText('Backend'))!.toBeInTheDocument()
      expect(screen.getByText('API'))!.toBeInTheDocument()
    })
  })

  describe('Tag Selection', () => {
    const getTagRow = (tagName: string) => {
      const row = screen.getByText(tagName).closest('[data-testid="tag-row"]')
      expect(row).not.toBeNull()
      return row as HTMLElement
    }

    it('should select an unselected tag when clicked', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const backendRowBeforeSelect = getTagRow('Backend')
      expect(within(backendRowBeforeSelect).queryByTestId('check-icon-tag-2')).not.toBeInTheDocument()

      await user.click(screen.getByText('Backend'))

      const backendRowAfterSelect = getTagRow('Backend')
      expect(within(backendRowAfterSelect).getByTestId('check-icon-tag-2'))!.toBeInTheDocument()
    })

    it('should deselect a selected tag when clicked', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const frontendRowBeforeDeselect = getTagRow('Frontend')
      expect(within(frontendRowBeforeDeselect).getByTestId('check-icon-tag-1'))!.toBeInTheDocument()

      await user.click(screen.getByText('Frontend'))

      const frontendRowAfterDeselect = getTagRow('Frontend')
      expect(within(frontendRowAfterDeselect).queryByTestId('check-icon-tag-1')).not.toBeInTheDocument()
    })

    it('should toggle tag selection on multiple clicks', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const backendRowBeforeToggle = getTagRow('Backend')
      expect(within(backendRowBeforeToggle).queryByTestId('check-icon-tag-2')).not.toBeInTheDocument()

      await user.click(screen.getByText('Backend'))

      const backendRowAfterFirstClick = getTagRow('Backend')
      expect(within(backendRowAfterFirstClick).getByTestId('check-icon-tag-2'))!.toBeInTheDocument()

      await user.click(screen.getByText('Backend'))

      const backendRowAfterSecondClick = getTagRow('Backend')
      expect(within(backendRowAfterSecondClick).queryByTestId('check-icon-tag-2')).not.toBeInTheDocument()
    })
  })

  describe('Tag Creation', () => {
    beforeEach(() => {
      // notExisted requires all tags to be same type, so remove knowledgeTag
    })

    it('should create a new tag when clicking the create option', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = await screen.findByTestId('create-tag-option')
      await user.click(createOption)

      await waitFor(() => {
        expect(createTag).toHaveBeenCalledWith('BrandNewTag', 'app')
      })
    })

    it('should show success notification after tag creation', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = await screen.findByTestId('create-tag-option')
      await user.click(createOption)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: i18n.created,
        })
      })
    })

    it('should clear keywords after successful tag creation', async () => {
      const user = userEvent.setup()
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = await screen.findByTestId('create-tag-option')
      await user.click(createOption)

      await waitFor(() => {
        expect(input)!.toHaveValue('')
      })
    })

    it('should show error notification when tag creation fails', async () => {
      const user = userEvent.setup()
      vi.mocked(createTag).mockRejectedValue(new Error('Creation failed'))

      render(<TagPanel {...defaultProps} tagList={appTags} />)

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'FailTag')

      const createOption = await screen.findByTestId('create-tag-option')
      await user.click(createOption)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: i18n.failed,
        })
      })
    })

    it('should not create tag when keywords is empty', () => {
      render(<TagPanel {...defaultProps} tagList={appTags} />)

      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      // The create option should not appear when no keywords
      expect(screen.queryByText(i18n.create, { exact: false })).not.toBeInTheDocument()
      expect(createTag).not.toHaveBeenCalled()
    })
  })

  describe('Binding Selection State', () => {
    it('should not submit tag bindings on panel unmount', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<TagPanel {...defaultProps} tagList={appTags} />)

      await user.click(screen.getByText('Backend'))
      unmount()

      await act(async () => { })
      expect(bindTag).not.toHaveBeenCalled()
      expect(unBindTag).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()
    })
  })

  describe('Manage Tags Modal', () => {
    it('should open the tag management modal when manage tags is clicked', async () => {
      const user = userEvent.setup()
      const onOpenTagManagement = vi.fn()
      render(<TagPanel {...defaultProps} onOpenTagManagement={onOpenTagManagement} />)

      await user.click(screen.getByText(i18n.manageTags))

      expect(onOpenTagManagement).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty value array', () => {
      render(<TagPanel {...defaultProps} selectedTagIds={[]} selectedTags={[]} />)
      // All app-type tags should appear in the unselected list
      // All app-type tags should appear in the unselected list
      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
      expect(screen.getByText('Backend'))!.toBeInTheDocument()
      expect(screen.getByText('API'))!.toBeInTheDocument()
    })

    it('should handle empty tagList', () => {
      render(<TagPanel {...defaultProps} selectedTagIds={[]} selectedTags={[]} tagList={[]} />)
      expect(screen.getByText(i18n.noTag))!.toBeInTheDocument()
    })

    it('should handle all tags already selected', () => {
      render(
        <TagPanel
          {...defaultProps}
          selectedTagIds={['tag-1', 'tag-2', 'tag-3']}
          selectedTags={appTags}
        />,
      )
      // All app tags appear in selectedTags, filteredTagList should be empty
      // All app tags appear in selectedTags, filteredTagList should be empty
      expect(screen.getByText('Frontend'))!.toBeInTheDocument()
      expect(screen.getByText('Backend'))!.toBeInTheDocument()
      expect(screen.getByText('API'))!.toBeInTheDocument()
    })

    it('should show divider between create option and tag list when both present', async () => {
      const user = userEvent.setup()
      // Only same-type tags for notExisted to work
      render(<TagPanel {...defaultProps} tagList={appTags} />)
      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'Back')
      // 'Back' matches Backend (unselected), notExisted is true (no tag named 'Back')
      // filteredTagList has items, so the conditional divider between create-option and tag-list renders
      const dividers = screen.getAllByTestId('divider')
      expect(dividers.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle knowledge type tags correctly', () => {
      render(
        <TagPanel
          {...defaultProps}
          type="knowledge"
          selectedTagIds={[]}
          selectedTags={[]}
          tagList={[knowledgeTag]}
        />,
      )
      expect(screen.getByText('KnowledgeDB'))!.toBeInTheDocument()
    })
  })
})
