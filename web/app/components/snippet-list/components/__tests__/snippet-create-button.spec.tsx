import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SnippetCreateButton from '../snippet-create-button'

const { mockPush, mockCreateMutate, mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockCreateMutate: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/service/use-snippets', () => ({
  useCreateSnippetMutation: () => ({
    mutate: mockCreateMutate,
    isPending: false,
  }),
}))

describe('SnippetCreateButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open the create dialog and create a snippet from the modal', async () => {
    mockCreateMutate.mockImplementation((_payload, options?: { onSuccess?: (snippet: { id: string }) => void }) => {
      options?.onSuccess?.({ id: 'snippet-123' })
    })

    render(<SnippetCreateButton />)

    fireEvent.click(screen.getByRole('button', { name: 'snippet.create' }))
    expect(screen.getByText('workflow.snippet.createDialogTitle')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
      target: { value: 'My Snippet' },
    })
    fireEvent.change(screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder'), {
      target: { value: 'Useful snippet description' },
    })
    fireEvent.click(screen.getByRole('button', { name: /workflow\.snippet\.confirm/i }))

    expect(mockCreateMutate).toHaveBeenCalledWith({
      body: {
        name: 'My Snippet',
        description: 'Useful snippet description',
      },
    }, expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-123/orchestrate')
    })

    expect(mockToastSuccess).toHaveBeenCalledWith('workflow.snippet.createSuccess')
  })
})
