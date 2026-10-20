import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.post': mockCreateMutateAsync,
      'workspaces.current.customizedSnippets.imports.post': mockImportMutateAsync,
      'workspaces.current.customizedSnippets.imports.byImportId.confirm.post':
        mockConfirmImportMutateAsync,
      'snippets.bySnippetId.workflows.draft.post': mockSyncDraftWorkflow,
    }),
  }
})

describe('SnippetCreateButton', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
  })

  it('should not render without snippet create permission', () => {
    mockWorkspacePermissionKeys.mockReturnValue([])

    render(<SnippetCreateButton />)

    expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
  })

  it('should open the create dialog and create a snippet from the modal', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValue({ id: 'snippet-123' })
    mockSyncDraftWorkflow.mockResolvedValue({
      result: 'success',
      hash: 'draft-hash',
      updated_at: 1704067200,
    })

    render(<SnippetCreateButton />)

    await user.click(screen.getByRole('button', { name: 'snippet.create' }))
    expect(screen.getByRole('dialog', { name: 'snippet.createFrom' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'snippet.createFromBlank' }))
    expect(screen.getByText('workflow.snippet.createDialogTitle')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), 'My Snippet')
    await user.type(
      screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder'),
      'Useful snippet description',
    )
    await user.click(screen.getByRole('button', { name: /workflow\.snippet\.confirm/i }))

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
  })

  it('should import a snippet from a DSL URL', async () => {
    const user = userEvent.setup()
    mockImportMutateAsync.mockResolvedValue({
      id: 'import-1',
      status: 'completed',
      snippet_id: 'snippet-imported',
      error: '',
    })

    render(<SnippetCreateButton />)

    await user.click(screen.getByRole('button', { name: 'snippet.create' }))
    await user.click(screen.getByRole('button', { name: 'snippet.importDSLFile' }))
    expect(screen.getByRole('dialog', { name: 'snippet.importDialogTitle' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'snippet.importFromDSLUrl' }))
    await user.type(
      screen.getByPlaceholderText('snippet.importFromDSLUrlPlaceholder'),
      'https://example.com/snippet.yml',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    await waitFor(() => {
      expect(mockImportMutateAsync).toHaveBeenCalledWith({
        body: {
          mode: 'yaml-url',
          yaml_content: undefined,
          yaml_url: 'https://example.com/snippet.yml',
        },
      })
    })
    expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-imported/orchestrate')
  })
})
