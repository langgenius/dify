import type { SnippetDetail } from '@/models/snippet'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import SnippetInfoMenu from '../actions-menu'

const mockReplace = vi.fn()
const mockDownloadBlob = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockUpdateMutate = vi.fn()
const mockExportMutateAsync = vi.fn()
const mockDeleteMutate = vi.fn()
let mockWorkspacePermissionKeys: string[] = ['snippets.create_and_modify', 'snippets.management']
const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, { workspacePermissionKeys: mockWorkspacePermissionKeys })

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (args: { data: Blob; fileName: string }) => mockDownloadBlob(args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const mockSnippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Social Media Repurposer',
  description: 'Turn one blog post into multiple social media variations.',
  updatedAt: '2026-03-25 10:00',
  usage: '12',
  tags: [],
  status: undefined,
}

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.bySnippetId.patch': (...args: unknown[]) =>
        mockUpdateMutate(...args),
      'workspaces.current.customizedSnippets.bySnippetId.delete': (...args: unknown[]) =>
        mockDeleteMutate(...args),
      'workspaces.current.customizedSnippets.bySnippetId.export.get': (...args: unknown[]) =>
        mockExportMutateAsync(...args),
    }),
  }
})

describe('SnippetInfoMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys = ['snippets.create_and_modify', 'snippets.management']
  })

  // Rendering coverage for the menu trigger itself.
  describe('Rendering', () => {
    it('should render nothing without snippet create or management permission', () => {
      mockWorkspacePermissionKeys = []

      render(<SnippetInfoMenu snippet={mockSnippet} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should split edit from export and delete actions by snippet permission', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['snippets.create_and_modify']

      const { unmount } = render(<SnippetInfoMenu snippet={mockSnippet} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(screen.getByText('snippet.menu.editInfo')).toBeInTheDocument()
      expect(screen.getByText('snippet.menu.exportSnippet')).toBeInTheDocument()
      expect(screen.queryByText('snippet.menu.deleteSnippet')).not.toBeInTheDocument()

      unmount()
      mockWorkspacePermissionKeys = ['snippets.management']
      render(<SnippetInfoMenu snippet={mockSnippet} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(screen.queryByText('snippet.menu.editInfo')).not.toBeInTheDocument()
      expect(screen.queryByText('snippet.menu.exportSnippet')).not.toBeInTheDocument()
      expect(screen.getByText('snippet.menu.deleteSnippet')).toBeInTheDocument()
    })
  })

  // Edit flow should seed the dialog with current snippet info and submit updates.
  describe('Edit Snippet', () => {
    it('should open the edit dialog and submit snippet updates', async () => {
      const user = userEvent.setup()
      mockUpdateMutate.mockResolvedValue({})

      render(<SnippetInfoMenu snippet={mockSnippet} />)
      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByText('snippet.menu.editInfo'))

      const name = screen.getByPlaceholderText('workflow.snippet.namePlaceholder')
      const description = screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder')
      expect(name).toHaveValue(mockSnippet.name)
      expect(description).toHaveValue(mockSnippet.description)
      await user.clear(name)
      await user.type(name, 'Updated snippet')
      await user.clear(description)
      await user.type(description, 'Updated description')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      await waitFor(() =>
        expect(mockUpdateMutate).toHaveBeenCalledWith({
          params: { snippet_id: mockSnippet.id },
          body: { name: 'Updated snippet', description: 'Updated description' },
        }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  // Export should call the export hook and download the returned YAML blob.
  describe('Export Snippet', () => {
    it('should export and download the snippet yaml', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['snippets.create_and_modify']
      mockExportMutateAsync.mockResolvedValue('yaml: content')

      render(<SnippetInfoMenu snippet={mockSnippet} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByText('snippet.menu.exportSnippet'))

      await waitFor(() => {
        expect(mockExportMutateAsync).toHaveBeenCalledWith({
          params: { snippet_id: mockSnippet.id },
          query: { include_secret: 'false', workflow_id: undefined },
        })
      })

      expect(mockDownloadBlob).toHaveBeenCalledWith({
        data: expect.any(Blob),
        fileName: `${mockSnippet.name}.yml`,
      })
      const blob = mockDownloadBlob.mock.calls[0]![0].data as Blob
      expect(await blob.text()).toBe('yaml: content')
    })

    it('should show an error toast when export fails', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys = ['snippets.create_and_modify']
      mockExportMutateAsync.mockRejectedValue(new Error('export failed'))

      render(<SnippetInfoMenu snippet={mockSnippet} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByText('snippet.menu.exportSnippet'))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('snippet.exportFailed')
      })
    })
  })

  // Delete should require confirmation and redirect after a successful mutation.
  describe('Delete Snippet', () => {
    it('should confirm deletion and redirect to the snippets list', async () => {
      const user = userEvent.setup()
      mockDeleteMutate.mockResolvedValue({})

      render(<SnippetInfoMenu snippet={mockSnippet} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(screen.getByText('snippet.menu.deleteSnippet'))

      expect(screen.getByText('snippet.deleteConfirmTitle')).toBeInTheDocument()
      expect(screen.getByText('snippet.deleteConfirmContent')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      await waitFor(() =>
        expect(mockDeleteMutate).toHaveBeenCalledWith({ params: { snippet_id: mockSnippet.id } }),
      )
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/snippets'))
      expect(mockToastSuccess).toHaveBeenCalledWith('snippet.deleted')
    })
  })
})
