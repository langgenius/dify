import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SnippetCreateCard from '../snippet-create-card'

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

vi.mock('@/app/components/base/ui/toast', () => ({
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

vi.mock('../snippet-import-dsl-dialog', () => ({
  default: ({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess?: (snippetId: string) => void }) => {
    if (!show)
      return null

    return (
      <div data-testid="snippet-import-dsl-dialog">
        <button type="button" onClick={() => onSuccess?.('snippet-imported')}>Complete Import</button>
        <button type="button" onClick={onClose}>Close Import</button>
      </div>
    )
  },
}))

describe('SnippetCreateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Create From Blank', () => {
    it('should open the create dialog and create a snippet from the modal', async () => {
      mockCreateMutate.mockImplementation((_payload, options?: { onSuccess?: (snippet: { id: string }) => void }) => {
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

      expect(mockCreateMutate).toHaveBeenCalledWith({
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

      expect(mockToastSuccess).toHaveBeenCalledWith('workflow.snippet.createSuccess')
    })
  })

  describe('Import DSL', () => {
    it('should open the import dialog and navigate when the import succeeds', async () => {
      render(<SnippetCreateCard />)

      fireEvent.click(screen.getByRole('button', { name: 'app.importDSL' }))
      expect(screen.getByTestId('snippet-import-dsl-dialog')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Complete Import' }))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-imported/orchestrate')
      })
    })
  })
})
