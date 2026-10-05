import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SnippetCreateButton from '../snippet-create-button'

const {
  mockPush,
  mockCreateMutateAsync,
  mockSyncDraftWorkflow,
  mockImportMutateAsync,
  mockConfirmImportMutateAsync,
  mockToastSuccess,
  mockToastError,
  mockWorkspacePermissionKeys,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockSyncDraftWorkflow: vi.fn(),
  mockImportMutateAsync: vi.fn(),
  mockConfirmImportMutateAsync: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockWorkspacePermissionKeys: vi.fn(() => ['snippets.create_and_modify']),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: string[], input: unknown) => {
      switch (path.join('.')) {
        case 'workspaces.current.customizedSnippets.post':
          return mockCreateMutateAsync(input)
        case 'snippets.bySnippetId.workflows.draft.post':
          return mockSyncDraftWorkflow(input)
        case 'workspaces.current.customizedSnippets.imports.post':
          return mockImportMutateAsync(input)
        case 'workspaces.current.customizedSnippets.imports.byImportId.confirm.post':
          return mockConfirmImportMutateAsync(input)
        default:
          throw new Error(`Unexpected request: ${path.join('.')}`)
      }
    },
  },
}))

describe('SnippetCreateButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
  })

  it('should not render without snippet create permission', () => {
    mockWorkspacePermissionKeys.mockReturnValue([])

    render(<SnippetCreateButton />)

    expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
  })

  it('should open the create dialog and create a snippet from the modal', async () => {
    mockCreateMutateAsync.mockResolvedValue({ id: 'snippet-123' })
    mockSyncDraftWorkflow.mockResolvedValue({
      result: 'success',
      hash: 'draft-hash',
      updated_at: 1704067200,
    })

    render(<SnippetCreateButton />)

    fireEvent.click(screen.getByRole('button', { name: 'snippet.create' }))
    expect(screen.getByRole('dialog', { name: 'snippet.createFrom' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'snippet.createFromBlank' }))
    expect(screen.getByText('workflow.snippet.createDialogTitle')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
      target: { value: 'My Snippet' },
    })
    fireEvent.change(screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder'), {
      target: { value: 'Useful snippet description' },
    })
    fireEvent.click(screen.getByRole('button', { name: /workflow\.snippet\.confirm/i }))

    await waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalledWith({
        body: {
          name: 'My Snippet',
          description: 'Useful snippet description',
          graph: {
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          input_fields: undefined,
        },
      })
    })
    expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-123' },
      body: {
        graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        input_fields: undefined,
      },
    })

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
    expect(screen.getByRole('dialog', { name: 'snippet.importDialogTitle' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' }))
    fireEvent.change(screen.getByPlaceholderText('snippet.importFromDSLUrlPlaceholder'), {
      target: { value: 'https://example.com/snippet.yml' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(mockImportMutateAsync).toHaveBeenCalledWith({
        body: {
          mode: 'yaml-url',
          yaml_content: undefined,
          yaml_url: 'https://example.com/snippet.yml',
        },
      })
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('snippet.importSuccess')
    expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-imported/orchestrate')
  })
  it('keeps the original failure contract: blank creation closes after the create request rejects', async () => {
    mockCreateMutateAsync.mockRejectedValueOnce(new Error('Create failed'))
    render(<SnippetCreateButton />)
    fireEvent.click(screen.getByRole('button', { name: 'snippet.create' }))
    fireEvent.click(screen.getByRole('button', { name: 'snippet.createFromBlank' }))
    fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
      target: { value: 'Failed snippet' },
    })
    fireEvent.click(screen.getByRole('button', { name: /workflow\.snippet\.confirm/i }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'workflow.snippet.createDialogTitle' }),
      ).not.toBeInTheDocument(),
    )
    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockSyncDraftWorkflow).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('keeps creation pending until the second draft request resolves, then closes and navigates', async () => {
    let resolveDraft!: (value: unknown) => void
    mockCreateMutateAsync.mockResolvedValueOnce({ id: 'pending-snippet' })
    mockSyncDraftWorkflow.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    render(<SnippetCreateButton />)
    fireEvent.click(screen.getByRole('button', { name: 'snippet.create' }))
    fireEvent.click(screen.getByRole('button', { name: 'snippet.createFromBlank' }))
    fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
      target: { value: 'Pending snippet' },
    })
    fireEvent.click(screen.getByRole('button', { name: /workflow\.snippet\.confirm/i }))
    await waitFor(() => expect(mockSyncDraftWorkflow).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole('dialog', { name: 'workflow.snippet.createDialogTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    expect(screen.getByPlaceholderText('workflow.snippet.namePlaceholder')).toBeDisabled()
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => resolveDraft({ result: 'success' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'workflow.snippet.createDialogTitle' }),
      ).not.toBeInTheDocument(),
    )
    expect(mockPush).toHaveBeenCalledExactlyOnceWith('/snippets/pending-snippet/orchestrate')
  })
})
