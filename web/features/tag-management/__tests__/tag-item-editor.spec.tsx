import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { act, render as renderComponent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'
import { TagItemEditor } from '../components/tag-item-editor'

const tagMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = vi.fn((message: unknown, options?: Record<string, unknown>) =>
    record({ message, ...options }),
  )
  return {
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    record,
    api: Object.assign(api, {
      success: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'success', message, ...options }),
      ),
      error: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'error', message, ...options }),
      ),
      warning: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'warning', message, ...options }),
      ),
      info: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'info', message, ...options }),
      ),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    }),
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'tags.byTagId.patch': tagMocks.updateTag,
      'tags.byTagId.delete': tagMocks.deleteTag,
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: tagMocks.api,
}))

const baseTag: Tag = {
  id: 'tag-1',
  name: 'Frontend',
  type: 'app',
  binding_count: '3',
}

const i18n = {
  editTag: 'common.operation.edit Frontend',
  removeTag: 'common.operation.remove Frontend',
  renameTag: 'common.operation.rename Frontend',
}

const render = (ui: Parameters<typeof renderComponent>[0]) =>
  renderComponent(ui, { wrapper: createQueryClientWrapper(createTestQueryClient()) })

describe('TagItemEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(tagMocks.updateTag).mockResolvedValue(undefined)
    vi.mocked(tagMocks.deleteTag).mockResolvedValue(undefined)
  })

  // Rendering behavior for initial tag display.
  describe('Rendering', () => {
    it('shows a resource-neutral explanation for the binding count', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      await user.hover(screen.getByText('3'))
      expect(await screen.findByText('common.tag.boundItems')).toBeVisible()
    })
  })

  // Edit flow behavior: enter editing, save, and validation/error cases.
  describe('Edit Flow', () => {
    it('should update tag and leave edit mode when submitting a new name', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByRole('button', { name: i18n.editTag })
      await user.click(editButton)

      const input = screen.getByRole('textbox', { name: i18n.renameTag })
      expect(input).toHaveValue('Frontend')
      await user.clear(input)
      await user.type(input, 'Frontend V2')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(tagMocks.updateTag).toHaveBeenCalledWith({
          params: { tag_id: 'tag-1' },
          body: { name: 'Frontend V2' },
        })
      })
      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    })

    it('should exit edit mode without calling update when submitted name is unchanged', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      await user.click(screen.getByRole('button', { name: i18n.editTag }))
      await user.keyboard('{Enter}')

      expect(tagMocks.updateTag).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    })

    it('should show validation error and skip update when name is empty', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByRole('button', { name: i18n.editTag })
      await user.click(editButton)

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.click(document.body)

      await waitFor(() => {
        expect(tagMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: 'tag name is empty',
        })
      })
      expect(tagMocks.updateTag).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should recover and notify error when update request fails', async () => {
      const user = userEvent.setup()
      vi.mocked(tagMocks.updateTag).mockRejectedValueOnce(new Error('update failed'))
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByRole('button', { name: i18n.editTag })
      await user.click(editButton)

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'Broken Name')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(tagMocks.updateTag).toHaveBeenCalledWith({
          params: { tag_id: 'tag-1' },
          body: { name: 'Broken Name' },
        })
      })
      await waitFor(() =>
        expect(tagMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        }),
      )
    })
  })

  // Remove behavior for direct delete and confirm modal paths.
  describe('Remove Flow', () => {
    it('should delete immediately when binding count is zero', async () => {
      const user = userEvent.setup()
      const removableTag: Tag = { ...baseTag, binding_count: '' }
      render(<TagItemEditor tag={removableTag} />)

      const removeButton = screen.getByRole('button', { name: i18n.removeTag })
      expect(removeButton).toBeInTheDocument()
      await user.click(removeButton)

      await waitFor(() => {
        expect(tagMocks.deleteTag).toHaveBeenCalledWith({ params: { tag_id: 'tag-1' } })
      })
      await waitFor(() =>
        expect(tagMocks.record).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.actionMsg.modifiedSuccessfully',
        }),
      )
    })

    it('does not send another delete while the first request is pending', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let finishDelete!: () => void
      tagMocks.deleteTag.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishDelete = resolve
          }),
      )
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onTagsChange = vi.fn()
      try {
        render(
          <TagItemEditor tag={{ ...baseTag, binding_count: '0' }} onTagsChange={onTagsChange} />,
        )
        const remove = screen.getByRole('button', { name: i18n.removeTag })
        await user.click(remove)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200)
        })
        expect(tagMocks.deleteTag).toHaveBeenCalledOnce()
        expect(onTagsChange).not.toHaveBeenCalled()
        await user.click(remove)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200)
        })
        expect(tagMocks.deleteTag).toHaveBeenCalledOnce()
        await act(async () => {
          finishDelete()
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(onTagsChange).toHaveBeenCalledOnce()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should open confirm modal and delete on confirm when binding count is non-zero', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const removeButton = screen.getByRole('button', { name: i18n.removeTag })
      await user.click(removeButton)

      expect(screen.getByText('common.tag.delete "Frontend"')).toBeInTheDocument()
      await user.click(screen.getByText('common.operation.confirm'))

      await waitFor(() => {
        expect(tagMocks.deleteTag).toHaveBeenCalledWith({ params: { tag_id: 'tag-1' } })
      })
      await waitFor(() => {
        expect(screen.queryByText('common.tag.delete "Frontend"')).not.toBeInTheDocument()
      })
    })

    it('should close confirm modal without deleting when cancel is clicked', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const removeButton = screen.getByRole('button', { name: i18n.removeTag })
      await user.click(removeButton)

      expect(screen.getByText('common.tag.delete "Frontend"')).toBeInTheDocument()
      await user.click(screen.getByText('common.operation.cancel'))

      expect(tagMocks.deleteTag).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.queryByText('common.tag.delete "Frontend"')).not.toBeInTheDocument()
      })
    })

    it('should notify error and keep tag when delete request fails', async () => {
      const user = userEvent.setup()
      vi.mocked(tagMocks.deleteTag).mockRejectedValueOnce(new Error('delete failed'))
      const removableTag: Tag = { ...baseTag, binding_count: '' }
      render(<TagItemEditor tag={removableTag} />)

      const removeButton = screen.getByRole('button', { name: i18n.removeTag })
      await user.click(removeButton)

      await waitFor(() => {
        expect(tagMocks.deleteTag).toHaveBeenCalledWith({ params: { tag_id: 'tag-1' } })
      })
      await waitFor(() =>
        expect(tagMocks.record).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        }),
      )
    })
  })
})
