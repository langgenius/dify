import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportSnippetDSLDialog from '../import-snippet-dsl-dialog'

const serviceMocks = vi.hoisted(() => ({
  importMutateAsync: vi.fn(),
  confirmMutateAsync: vi.fn(),
}))

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMocks,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks,
}))

vi.mock('@/service/use-snippets', () => ({
  useImportSnippetDSLMutation: () => ({
    isPending: false,
    mutateAsync: serviceMocks.importMutateAsync,
  }),
  useConfirmSnippetImportMutation: () => ({
    isPending: false,
    mutateAsync: serviceMocks.confirmMutateAsync,
  }),
}))

vi.mock('@/app/components/app/create-from-dsl-modal/uploader', () => ({
  default: ({
    file,
    updateFile,
  }: {
    file?: File
    updateFile: (file?: File) => void
  }) => (
    <button type="button" onClick={() => updateFile(new File(['name: snippet'], 'snippet.yml'))}>
      {file?.name || 'select-dsl-file'}
    </button>
  ),
}))

describe('ImportSnippetDSLDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should import a snippet DSL from URL and navigate to the imported snippet', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    serviceMocks.importMutateAsync.mockResolvedValue({
      id: 'import-1',
      status: 'completed',
      snippet_id: 'snippet-1',
      error: '',
    })

    render(<ImportSnippetDSLDialog isOpen onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'snippet.importFromDSLUrl' }))
    await user.type(screen.getByPlaceholderText('snippet.importFromDSLUrlPlaceholder'), 'https://example.com/snippet.yml')
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(serviceMocks.importMutateAsync).toHaveBeenCalledWith({
        mode: 'yaml-url',
        yamlContent: undefined,
        yamlUrl: 'https://example.com/snippet.yml',
      })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(toastMocks.success).toHaveBeenCalledWith('snippet.importSuccess')
      expect(routerMocks.push).toHaveBeenCalledWith('/snippets/snippet-1/orchestrate')
    })
  })

  it('should confirm pending imports before navigating to the snippet', async () => {
    const user = userEvent.setup()
    serviceMocks.importMutateAsync.mockResolvedValue({
      id: 'import-1',
      status: 'pending',
      current_dsl_version: '1.0.0',
      imported_dsl_version: '0.9.0',
      error: '',
    })
    serviceMocks.confirmMutateAsync.mockResolvedValue({
      id: 'import-1',
      status: 'completed-with-warnings',
      snippet_id: 'snippet-2',
      error: '',
    })

    render(<ImportSnippetDSLDialog isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'select-dsl-file' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(await screen.findByText('snippet.dslVersionMismatchTitle')).toBeInTheDocument()
    expect(screen.getByText('0.9.0')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(serviceMocks.confirmMutateAsync).toHaveBeenCalledWith({ importId: 'import-1' })
      expect(routerMocks.push).toHaveBeenCalledWith('/snippets/snippet-2/orchestrate')
    })
  })

  it('should show import errors without closing the dialog', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    serviceMocks.importMutateAsync.mockRejectedValue(new Error('invalid yaml'))

    render(<ImportSnippetDSLDialog isOpen onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'select-dsl-file' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith('invalid yaml')
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
