import type { Tag } from '@/contract/console/tags'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { TagItemEditor } from '../components/tag-item-editor'

const tagMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = vi.fn((message: unknown, options?: Record<string, unknown>) => record({ message, ...options }))
  return {
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    record,
    api: Object.assign(api, {
      success: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'success', message, ...options })),
      error: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'error', message, ...options })),
      warning: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'warning', message, ...options })),
      info: vi.fn((message: unknown, options?: Record<string, unknown>) => record({ type: 'info', message, ...options })),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    }),
  }
})

vi.mock('../hooks/use-tag-mutations', () => ({
  useUpdateTagMutation: () => ({
    mutate: ({ params, body }: { params: { tagId: string }, body: { name: string } }, options?: { onSuccess?: () => void, onError?: () => void }) => {
      Promise.resolve(tagMocks.updateTag(params.tagId, body.name))
        .then(() => options?.onSuccess?.())
        .catch(() => options?.onError?.())
    },
  }),
  useDeleteTagMutation: () => ({
    isPending: false,
    mutate: ({ params }: { params: { tagId: string } }, options?: { onSuccess?: () => void, onError?: () => void }) => {
      Promise.resolve(tagMocks.deleteTag(params.tagId))
        .then(() => options?.onSuccess?.())
        .catch(() => options?.onError?.())
    },
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: tagMocks.api,
}))

vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useDebounceFn: (fn: (...args: unknown[]) => void) => ({
      run: (...args: unknown[]) => fn(...args),
    }),
  }
})

vi.mock('use-context-selector', () => ({
  createContext: <T,>(defaultValue: T) => React.createContext(defaultValue),
  useContext: () => ({
    notify: tagMocks.api,
  }),
}))

const baseTag: Tag = {
  id: 'tag-1',
  name: 'Frontend',
  type: 'app',
  binding_count: 3,
}

describe('TagItemEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(tagMocks.updateTag).mockResolvedValue(undefined)
    vi.mocked(tagMocks.deleteTag).mockResolvedValue(undefined)
  })

  // Rendering behavior for initial tag display.
  describe('Rendering', () => {
    it('should render tag name and binding count', () => {
      render(<TagItemEditor tag={baseTag} />)

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })
  })

  // Edit flow behavior: enter editing, save, and validation/error cases.
  describe('Edit Flow', () => {
    it('should enter editing mode when edit icon is clicked', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByTestId('tag-item-editor-edit-button')
      expect(editButton).toBeInTheDocument()
      await user.click(editButton as HTMLElement)

      expect(screen.getByRole('textbox')).toHaveValue('Frontend')
    })

    it('should update tag and notify success when submitting a new name', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByTestId('tag-item-editor-edit-button')
      await user.click(editButton as HTMLElement)

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'Frontend V2')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(tagMocks.updateTag).toHaveBeenCalledWith('tag-1', 'Frontend V2')
      })
      expect(tagMocks.record).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should exit edit mode without calling update when submitted name is unchanged', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      await user.click(screen.getByTestId('tag-item-editor-edit-button') as HTMLElement)
      await user.keyboard('{Enter}')

      expect(tagMocks.updateTag).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should show validation error and skip update when name is empty', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByTestId('tag-item-editor-edit-button')
      await user.click(editButton as HTMLElement)

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
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should recover and notify error when update request fails', async () => {
      const user = userEvent.setup()
      vi.mocked(tagMocks.updateTag).mockRejectedValueOnce(new Error('update failed'))
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByTestId('tag-item-editor-edit-button')
      await user.click(editButton as HTMLElement)

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'Broken Name')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(tagMocks.updateTag).toHaveBeenCalledWith('tag-1', 'Broken Name')
      })
      expect(tagMocks.record).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      })
    })
  })

  // Remove behavior for direct delete and confirm modal paths.
  describe('Remove Flow', () => {
    it('should delete immediately when binding count is zero', async () => {
      const user = userEvent.setup()
      const removableTag: Tag = { ...baseTag, binding_count: 0 }
      render(<TagItemEditor tag={removableTag} />)

      const removeButton = screen.getByTestId('tag-item-editor-remove-button')
      expect(removeButton).toBeInTheDocument()
      await user.click(removeButton as HTMLElement)

      await waitFor(() => {
        expect(tagMocks.deleteTag).toHaveBeenCalledWith('tag-1')
      })
      expect(tagMocks.record).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
    })

    it('should open confirm modal and delete on confirm when binding count is non-zero', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const removeButton = screen.getByTestId('tag-item-editor-remove-button')
      await user.click(removeButton as HTMLElement)

      expect(screen.getByText('common.tag.delete "Frontend"')).toBeInTheDocument()
      await user.click(screen.getByText('common.operation.confirm'))

      await waitFor(() => {
        expect(tagMocks.deleteTag).toHaveBeenCalledWith('tag-1')
      })
      await waitFor(() => {
        expect(screen.queryByText('common.tag.delete "Frontend"')).not.toBeInTheDocument()
      })
    })

    it('should close confirm modal without deleting when cancel is clicked', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const removeButton = screen.getByTestId('tag-item-editor-remove-button')
      await user.click(removeButton as HTMLElement)

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
      const removableTag: Tag = { ...baseTag, binding_count: 0 }
      render(<TagItemEditor tag={removableTag} />)

      const removeButton = screen.getByTestId('tag-item-editor-remove-button')
      await user.click(removeButton as HTMLElement)

      await waitFor(() => {
        expect(tagMocks.deleteTag).toHaveBeenCalledWith('tag-1')
      })
      expect(tagMocks.record).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      })
    })
  })
})
