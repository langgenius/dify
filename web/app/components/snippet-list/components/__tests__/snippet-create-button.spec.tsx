import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SnippetCreateButton from '../snippet-create-button'

const { mockPush, mockCreateMutate, mockImportMutateAsync, mockConfirmImportMutateAsync, mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockCreateMutate: vi.fn(),
  mockImportMutateAsync: vi.fn(),
  mockConfirmImportMutateAsync: vi.fn(),
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
  useImportSnippetDSLMutation: () => ({
    mutateAsync: mockImportMutateAsync,
    isPending: false,
  }),
  useConfirmSnippetImportMutation: () => ({
    mutateAsync: mockConfirmImportMutateAsync,
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
    fireEvent.click(screen.getByRole('button', { name: 'snippet.createFromBlank' }))
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
    }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-123/orchestrate')
    })

    expect(mockToastSuccess).toHaveBeenCalledWith('workflow.snippet.createSuccess')
  })

  it('should import a snippet from a DSL URL', async () => {
    mockImportMutateAsync.mockResolvedValue({
      id: 'import-1',
      status: 'completed',
      snippet_id: 'snippet-imported',
      error: '',
    })

    render(<SnippetCreateButton />)

    fireEvent.click(screen.getByRole('button', { name: 'snippet.create' }))
    fireEvent.click(screen.getByRole('button', { name: 'snippet.importDSLFile' }))
    expect(screen.getByText('snippet.importDialogTitle')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'snippet.importFromDSLUrl' }))
    fireEvent.change(screen.getByPlaceholderText('snippet.importFromDSLUrlPlaceholder'), {
      target: { value: 'https://example.com/snippet.yml' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(mockImportMutateAsync).toHaveBeenCalledWith({
        mode: 'yaml-url',
        yamlContent: undefined,
        yamlUrl: 'https://example.com/snippet.yml',
      })
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('snippet.importSuccess')
    expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-imported/orchestrate')
  })
})
