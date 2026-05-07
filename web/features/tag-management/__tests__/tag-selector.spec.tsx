import type { ComponentProps } from 'react'
import type { Tag } from '@/contract/console/tags'
import { render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: mockToast }))

const { mockUseQueryData, createTag, bindTag, unBindTag } = vi.hoisted(() => {
  const mockUseQueryData: { current: Tag[] } = { current: [] }
  return {
    mockUseQueryData,
    createTag: vi.fn(),
    bindTag: vi.fn(),
    unBindTag: vi.fn(),
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockUseQueryData.current }),
}))

vi.mock('../hooks/use-tag-mutations', () => ({
  useCreateTagMutation: () => ({
    isPending: false,
    mutate: ({ body }: { body: { name: string, type: 'app' | 'knowledge' } }, options?: { onSuccess?: (tag: Tag) => void, onError?: () => void }) => {
      const tag: Tag = { id: 'new-tag', name: body.name, type: body.type, binding_count: 0 }
      Promise.resolve(createTag(body.name, body.type))
        .then(() => options?.onSuccess?.(tag))
        .catch(() => options?.onError?.())
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

const i18n = {
  addTag: 'common.tag.addTag',
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  manageTags: 'common.tag.manageTags',
  modifiedSuccessfully: 'common.actionMsg.modifiedSuccessfully',
  modifiedUnsuccessfully: 'common.actionMsg.modifiedUnsuccessfully',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
]

const defaultProps = {
  targetId: 'target-1',
  type: 'app',
  value: [appTags[0]!],
} satisfies ComponentProps<typeof TagSelector>

describe('TagSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryData.current = appTags
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
    vi.mocked(bindTag).mockResolvedValue(undefined)
    vi.mocked(unBindTag).mockResolvedValue(undefined)
  })

  it('renders selected tag names in the combobox trigger', () => {
    render(<TagSelector {...defaultProps} />)
    expect(screen.getByText('Frontend')).toBeInTheDocument()
  })

  it('renders the add tag trigger when no current tag is visible in the workspace tag list', () => {
    render(<TagSelector {...defaultProps} value={[{ id: 'orphan', name: 'Orphan', type: 'app', binding_count: 0 }]} />)
    expect(screen.queryByText('Orphan')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.addTag)).toBeInTheDocument()
  })

  it('opens a searchable combobox popup', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    await user.click(screen.getByRole('combobox', { name: /Frontend/i }))

    expect(await screen.findByRole('combobox', { name: i18n.selectorPlaceholder })).toBeInTheDocument()
    expect(screen.getByText(i18n.manageTags)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Backend/i })).toBeInTheDocument()
  })

  it('applies added tags only when the popup closes', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Backend/i }))

    expect(bindTag).not.toHaveBeenCalled()

    await user.click(trigger)

    await waitFor(() => {
      expect(bindTag).toHaveBeenCalledWith(['tag-2'], 'target-1', 'app')
    })
    expect(mockToast.success).toHaveBeenCalledWith(i18n.modifiedSuccessfully, {
      id: 'tag-bindings-app-target-1',
    })
  })

  it('applies removed tags only when the popup closes', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Frontend/i }))
    await user.click(trigger)

    await waitFor(() => {
      expect(unBindTag).toHaveBeenCalledWith('tag-1', 'target-1', 'app')
    })
  })

  it('does not submit unchanged draft selections on close', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    render(<TagSelector {...defaultProps} onTagsChange={onTagsChange} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await screen.findByRole('combobox', { name: i18n.selectorPlaceholder })
    await user.click(trigger)

    expect(bindTag).not.toHaveBeenCalled()
    expect(unBindTag).not.toHaveBeenCalled()
    expect(mockToast.success).not.toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(onTagsChange).not.toHaveBeenCalled()
  })

  it('notifies after apply settles with success or error', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    render(<TagSelector {...defaultProps} onTagsChange={onTagsChange} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Backend/i }))
    await user.click(trigger)

    await waitFor(() => {
      expect(onTagsChange).toHaveBeenCalledTimes(1)
    })
  })

  it('shows an error toast when applying bindings fails', async () => {
    const user = userEvent.setup()
    vi.mocked(unBindTag).mockRejectedValueOnce(new Error('Unbind failed'))
    render(<TagSelector {...defaultProps} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Frontend/i }))
    await user.click(trigger)

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(i18n.modifiedUnsuccessfully, {
        id: 'tag-bindings-app-target-1',
      })
    })
  })

  it('creates a tag with the current tag type without binding it implicitly', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} type="knowledge" value={[]} />)

    await user.click(screen.getByRole('combobox', { name: i18n.addTag }))
    await user.type(await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }), 'NewKnowledgeTag')
    await user.click(await screen.findByTestId('create-tag-option'))

    await waitFor(() => {
      expect(createTag).toHaveBeenCalledWith('NewKnowledgeTag', 'knowledge')
    })
    expect(bindTag).not.toHaveBeenCalled()
  })
})
