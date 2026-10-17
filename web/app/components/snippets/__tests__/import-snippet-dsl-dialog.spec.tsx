import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { httpErrorFromResponse } from '@/service/http-error'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
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

const contextMocks = vi.hoisted(() => ({
  workspacePermissionKeys: ['snippets.create_and_modify'] as string[],
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMocks,
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: contextMocks.workspacePermissionKeys,
  }))
})

vi.mock('@/app/notifications', () => ({
  toast: toastMocks,
}))

vi.mock('@/app/components/app/create-from-dsl-modal/uploader', () => ({
  Uploader: ({ file, updateFile }: { file?: File; updateFile: (file?: File) => void }) => (
    <button type="button" onClick={() => updateFile(new File(['name: snippet'], 'snippet.yml'))}>
      {file?.name || 'select-dsl-file'}
    </button>
  ),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.imports.post': serviceMocks.importMutateAsync,
      'workspaces.current.customizedSnippets.imports.byImportId.confirm.post':
        serviceMocks.confirmMutateAsync,
    }),
  }
})

describe('ImportSnippetDSLDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextMocks.workspacePermissionKeys = ['snippets.create_and_modify']
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

    expect(screen.getByRole('dialog', { name: 'snippet.importDialogTitle' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'snippet.importDialogTitle' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'snippet.importFromDSLFile' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.click(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' }))
    expect(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.type(
      screen.getByPlaceholderText('snippet.importFromDSLUrlPlaceholder'),
      'https://example.com/snippet.yml',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(serviceMocks.importMutateAsync).toHaveBeenCalledWith({
        body: {
          mode: 'yaml-url',
          yaml_content: undefined,
          yaml_url: 'https://example.com/snippet.yml',
        },
      })
      expect(onClose).toHaveBeenCalledTimes(1)
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
      expect(serviceMocks.confirmMutateAsync).toHaveBeenCalledWith({
        params: { import_id: 'import-1' },
      })
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

  it.each(['import', 'confirm'])('leaves HTTP %s failures to the request layer', async (step) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const error = await httpErrorFromResponse(
      Response.json({ message: 'Invalid DSL' }, { status: 400 }),
    )
    if (step === 'import') serviceMocks.importMutateAsync.mockRejectedValue(error)
    else {
      serviceMocks.importMutateAsync.mockResolvedValue({ id: 'import-1', status: 'pending' })
      serviceMocks.confirmMutateAsync.mockRejectedValue(error)
    }

    render(<ImportSnippetDSLDialog isOpen onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'select-dsl-file' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    if (step === 'confirm') {
      await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))
      expect(serviceMocks.confirmMutateAsync).toHaveBeenCalledWith({
        params: { import_id: 'import-1' },
      })
    }
    expect(serviceMocks.importMutateAsync).toHaveBeenCalledOnce()
    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('should disable import without snippet create permission', async () => {
    const user = userEvent.setup()
    contextMocks.workspacePermissionKeys = []

    render(<ImportSnippetDSLDialog isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' }))
    await user.type(
      screen.getByPlaceholderText('snippet.importFromDSLUrlPlaceholder'),
      'https://example.com/snippet.yml',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
    expect(serviceMocks.importMutateAsync).not.toHaveBeenCalled()
  })
})
