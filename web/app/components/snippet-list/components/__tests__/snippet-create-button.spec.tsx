import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SnippetCreateButton from '../snippet-create-button'

const { mockPush, mockCreateMutateAsync, mockSyncDraftWorkflow, mockImportMutateAsync, mockConfirmImportMutateAsync, mockToastSuccess, mockToastError, mockWorkspacePermissionKeys } = vi.hoisted(() => ({
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

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }),
  useSelector: <T,>(selector: (state: { workspacePermissionKeys: string[] }) => T): T => selector({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }),
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/service/use-snippets', () => ({
  useCreateSnippetMutation: () => ({
    mutateAsync: mockCreateMutateAsync,
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

vi.mock('@/service/client', () => ({
  consoleClient: {
    snippets: {
      bySnippetId: {
        workflows: {
          draft: {
            post: mockSyncDraftWorkflow,
          },
        },
      },
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
    mockSyncDraftWorkflow.mockResolvedValue({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 })

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
