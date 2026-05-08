import type { Tag } from '@/contract/console/tags'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import * as ReactI18next from 'react-i18next'
import { TagManagementModal } from '../components/tag-management-modal'

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

const { mockUseQueryData, createTag } = vi.hoisted(() => ({
  mockUseQueryData: { current: [] as Tag[] },
  createTag: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockUseQueryData.current }),
  useMutation: (mutationOptions: { mutationFn: (input: unknown) => Promise<unknown> }) => ({
    isPending: false,
    mutate: (input: unknown, options?: { onSuccess?: () => void, onError?: () => void }) => {
      Promise.resolve(mutationOptions.mutationFn(input))
        .then(() => options?.onSuccess?.())
        .catch(() => options?.onError?.())
    },
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    tags: {
      list: {
        queryOptions: () => ({}),
      },
      create: {
        mutationOptions: () => ({
          mutationFn: ({ body }: { body: { name: string, type: 'app' | 'knowledge' } }) => createTag(body.name, body.type),
        }),
      },
      update: {
        mutationOptions: () => ({
          mutationFn: () => Promise.resolve(undefined),
        }),
      },
      delete: {
        mutationOptions: () => ({
          mutationFn: () => Promise.resolve(undefined),
        }),
      },
    },
  },
}))

const mockTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
  { id: 'tag-3', name: 'Database', type: 'knowledge', binding_count: 2 },
]

const defaultProps = {
  type: 'app' as const,
  show: true,
  onClose: vi.fn(),
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
    mockUseQueryData.current = mockTags
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
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

    it('should fallback to empty placeholder when translation returns empty', () => {
      const mockedTranslation = {
        t: vi.fn().mockReturnValue(''),
        i18n: {} as ReturnType<typeof ReactI18next.useTranslation>['i18n'],
        ready: true,
      } as unknown as ReturnType<typeof ReactI18next.useTranslation>

      vi.spyOn(ReactI18next, 'useTranslation').mockReturnValueOnce(mockedTranslation)

      render(<TagManagementModal {...defaultProps} />)
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '')
    })

    it('should render existing tags from query data', () => {
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

  describe('User Interactions', () => {
    it('should close modal when close button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<TagManagementModal {...defaultProps} onClose={onClose} />)

      await user.click(screen.getByTestId('tag-management-modal-close-button'))

      expect(onClose).toHaveBeenCalledTimes(1)
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

    it('should create a tag on input blur-sm', async () => {
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
  })

  describe('Edge Cases', () => {
    it('should handle empty tag list', () => {
      mockUseQueryData.current = []

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
      const onClose = vi.fn()
      render(<TagManagementModal {...defaultProps} onClose={onClose} />)
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })
  })
})
