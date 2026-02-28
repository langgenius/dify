import type { Tag } from '@/app/components/base/tag-management/constant'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { act } from 'react'
import { useStore as useTagStore } from './store'
import TagItemEditor from './tag-item-editor'

const { updateTag, deleteTag, mockNotify } = vi.hoisted(() => ({
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/service/tag', () => ({
  updateTag,
  deleteTag,
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
    notify: mockNotify,
  }),
}))

const baseTag: Tag = {
  id: 'tag-1',
  name: 'Frontend',
  type: 'app',
  binding_count: 3,
}

const anotherTag: Tag = {
  id: 'tag-2',
  name: 'Backend',
  type: 'app',
  binding_count: 1,
}

describe('TagItemEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateTag).mockResolvedValue(undefined)
    vi.mocked(deleteTag).mockResolvedValue(undefined)
    act(() => {
      useTagStore.setState({
        tagList: [baseTag, anotherTag],
        showTagManagementModal: false,
      })
    })
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
        expect(updateTag).toHaveBeenCalledWith('tag-1', 'Frontend V2')
      })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
      expect(useTagStore.getState().tagList.find(tag => tag.id === 'tag-1')?.name).toBe('Frontend V2')
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
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'tag name is empty',
        })
      })
      expect(updateTag).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should recover and notify error when update request fails', async () => {
      const user = userEvent.setup()
      vi.mocked(updateTag).mockRejectedValueOnce(new Error('update failed'))
      render(<TagItemEditor tag={baseTag} />)

      const editButton = screen.getByTestId('tag-item-editor-edit-button')
      await user.click(editButton as HTMLElement)

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'Broken Name')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(updateTag).toHaveBeenCalledWith('tag-1', 'Broken Name')
      })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      })
      expect(useTagStore.getState().tagList.find(tag => tag.id === 'tag-1')?.name).toBe('Frontend')
    })
  })

  // Remove behavior for direct delete and confirm modal paths.
  describe('Remove Flow', () => {
    it('should delete immediately when binding count is zero', async () => {
      const user = userEvent.setup()
      const removableTag: Tag = { ...baseTag, binding_count: 0 }
      act(() => {
        useTagStore.setState({ tagList: [removableTag, anotherTag] })
      })
      render(<TagItemEditor tag={removableTag} />)

      const removeButton = screen.getByTestId('tag-item-editor-remove-button')
      expect(removeButton).toBeInTheDocument()
      await user.click(removeButton as HTMLElement)

      await waitFor(() => {
        expect(deleteTag).toHaveBeenCalledWith('tag-1')
      })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
      expect(useTagStore.getState().tagList.find(tag => tag.id === 'tag-1')).toBeUndefined()
    })

    it('should open confirm modal and delete on confirm when binding count is non-zero', async () => {
      const user = userEvent.setup()
      render(<TagItemEditor tag={baseTag} />)

      const removeButton = screen.getByTestId('tag-item-editor-remove-button')
      await user.click(removeButton as HTMLElement)

      expect(screen.getByText('common.tag.delete "Frontend"')).toBeInTheDocument()
      await user.click(screen.getByText('common.operation.confirm'))

      await waitFor(() => {
        expect(deleteTag).toHaveBeenCalledWith('tag-1')
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

      expect(deleteTag).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.queryByText('common.tag.delete "Frontend"')).not.toBeInTheDocument()
      })
    })

    it('should notify error and keep tag when delete request fails', async () => {
      const user = userEvent.setup()
      vi.mocked(deleteTag).mockRejectedValueOnce(new Error('delete failed'))
      const removableTag: Tag = { ...baseTag, binding_count: 0 }
      act(() => {
        useTagStore.setState({ tagList: [removableTag, anotherTag] })
      })
      render(<TagItemEditor tag={removableTag} />)

      const removeButton = screen.getByTestId('tag-item-editor-remove-button')
      await user.click(removeButton as HTMLElement)

      await waitFor(() => {
        expect(deleteTag).toHaveBeenCalledWith('tag-1')
      })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      })
      expect(useTagStore.getState().tagList.find(tag => tag.id === 'tag-1')).toBeDefined()
    })
  })
})
