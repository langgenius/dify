import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { ImportSnippetDSLDialog } from '../import-snippet-dsl-dialog'

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

describe('ImportSnippetDSLDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contextMocks.workspacePermissionKeys = ['snippets.create_and_modify']
  })

  it('should import a snippet DSL from URL and navigate to the imported snippet', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    serviceMocks.importMutateAsync.mockResolvedValue({
      id: 'import-1',
      status: 'completed',
      snippet_id: 'snippet-1',
      error: '',
    })

    render(<ImportSnippetDSLDialog open onOpenChange={onOpenChange} />)

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
        mode: 'yaml-url',
        yamlContent: undefined,
        yamlUrl: 'https://example.com/snippet.yml',
      })
      expect(onOpenChange).toHaveBeenCalledTimes(1)
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

    render(<ImportSnippetDSLDialog open onOpenChange={vi.fn()} />)

    const fileInput = screen.getByRole('dialog').querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('Missing DSL file input')
    await user.upload(fileInput, new File(['name: snippet'], 'snippet.yml'))
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
    const onOpenChange = vi.fn()
    serviceMocks.importMutateAsync.mockRejectedValue(new Error('invalid yaml'))

    render(<ImportSnippetDSLDialog open onOpenChange={onOpenChange} />)

    const fileInput = screen.getByRole('dialog').querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('Missing DSL file input')
    await user.upload(fileInput, new File(['name: snippet'], 'snippet.yml'))
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith('invalid yaml')
      expect(onOpenChange).not.toHaveBeenCalled()
    })
  })

  it('should disable import without snippet create permission', async () => {
    const user = userEvent.setup()
    contextMocks.workspacePermissionKeys = []

    render(<ImportSnippetDSLDialog open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' }))
    await user.type(
      screen.getByPlaceholderText('snippet.importFromDSLUrlPlaceholder'),
      'https://example.com/snippet.yml',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(screen.getByRole('button', { name: 'common.operation.create' })).toBeDisabled()
    expect(serviceMocks.importMutateAsync).not.toHaveBeenCalled()
  })
  it.each(['Invalid DSL', ''])(
    'keeps a failed import open and only reports a supplied error (%s)',
    async (error) => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      serviceMocks.importMutateAsync.mockResolvedValue({
        id: 'failed-import',
        status: 'failed',
        error,
      })
      render(<ImportSnippetDSLDialog open onOpenChange={onOpenChange} />)
      await user.click(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' }))
      await user.type(
        screen.getByRole('textbox', { name: 'DSL URL' }),
        'https://example.com/invalid.yml',
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
      await waitFor(() => expect(serviceMocks.importMutateAsync).toHaveBeenCalledTimes(1))
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(routerMocks.push).not.toHaveBeenCalled()
      if (error) expect(toastMocks.error).toHaveBeenCalledExactlyOnceWith(error)
      else expect(toastMocks.error).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'DSL URL' })).toHaveValue(
        'https://example.com/invalid.yml',
      )
    },
  )

  it('keeps the version confirmation after a rejected confirm and retries the same import', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    serviceMocks.importMutateAsync.mockResolvedValue({ id: 'retry-import', status: 'pending' })
    serviceMocks.confirmMutateAsync
      .mockRejectedValueOnce(new Error('Confirm failed'))
      .mockResolvedValueOnce({
        id: 'retry-import',
        status: 'completed',
        snippet_id: 'retry-snippet',
      })
    render(<ImportSnippetDSLDialog open onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' }))
    await user.type(
      screen.getByRole('textbox', { name: 'DSL URL' }),
      'https://example.com/retry.yml',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith('Confirm failed'))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
    expect(serviceMocks.confirmMutateAsync.mock.calls).toEqual([
      [{ importId: 'retry-import' }],
      [{ importId: 'retry-import' }],
    ])
    expect(routerMocks.push).toHaveBeenCalledExactlyOnceWith('/snippets/retry-snippet/orchestrate')
  })
})
