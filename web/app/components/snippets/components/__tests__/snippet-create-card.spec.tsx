import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SnippetCreateCard from '../snippet-create-card'

const { mockPush, mockMutate, mockToastSuccess } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockMutate: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: vi.fn(),
  },
}))

vi.mock('@/service/use-snippets', () => ({
  useCreateSnippetMutation: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}))

describe('SnippetCreateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Create From Blank', () => {
    it('should open the create dialog and create a snippet from the modal', async () => {
      mockMutate.mockImplementation((_payload, options?: { onSuccess?: (snippet: { id: string }) => void }) => {
        options?.onSuccess?.({ id: 'snippet-123' })
      })

      render(<SnippetCreateCard />)

      fireEvent.click(screen.getByRole('button', { name: 'snippet.createFromBlank' }))
      expect(screen.getByText('workflow.snippet.createDialogTitle')).toBeInTheDocument()

      fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
        target: { value: 'My Snippet' },
      })
      fireEvent.change(screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder'), {
        target: { value: 'Useful snippet description' },
      })
      fireEvent.click(screen.getByRole('button', { name: /workflow\.snippet\.confirm/i }))

      expect(mockMutate).toHaveBeenCalledWith({
        body: {
          name: 'My Snippet',
          description: 'Useful snippet description',
          icon_info: {
            icon: '🤖',
            icon_type: 'emoji',
            icon_background: '#FFEAD5',
            icon_url: undefined,
          },
        },
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-123/orchestrate')
      })

      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.createSuccess')
    })
  })
})
