import type { SnippetListItem } from '@/types/snippet'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SnippetCard from '../snippet-card'

const {
  mockDeleteMutate,
  mockDownloadBlob,
  mockExportMutateAsync,
  mockOnRefresh,
  mockToastError,
  mockToastSuccess,
  mockUpdateMutate,
} = vi.hoisted(() => ({
  mockDeleteMutate: vi.fn(),
  mockDownloadBlob: vi.fn(),
  mockExportMutateAsync: vi.fn(),
  mockOnRefresh: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockUpdateMutate: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'creator-id', name: 'Creator', email: 'creator@example.com', avatar: '', avatar_url: null, role: 'editor', last_login_at: '', created_at: '', status: 'active' },
        { id: 'updater-id', name: 'Updater', email: 'updater@example.com', avatar: '', avatar_url: null, role: 'editor', last_login_at: '', created_at: '', status: 'active' },
      ],
    },
  }),
}))

vi.mock('@/service/use-snippets', () => ({
  useDeleteSnippetMutation: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
  useExportSnippetMutation: () => ({
    mutateAsync: mockExportMutateAsync,
  }),
  useUpdateSnippetMutation: () => ({
    mutate: mockUpdateMutate,
    isPending: false,
  }),
}))

vi.mock('@/utils/time', () => ({
  formatTime: () => 'formatted-time',
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mockDownloadBlob,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/features/tag-management/components/tag-selector', () => ({
  TagSelector: ({ value }: { value: Array<{ name: string }> }) => (
    <div data-testid="snippet-tags">{value.map(tag => tag.name).join(', ')}</div>
  ),
}))

const createSnippet = (overrides: Partial<SnippetListItem> = {}): SnippetListItem => ({
  id: 'snippet-1',
  name: 'Tone Rewriter',
  description: 'Rewrites rough drafts.',
  type: 'node',
  is_published: true,
  use_count: 19,
  tags: [],
  created_at: 1_704_067_200,
  created_by: 'creator-id',
  updated_at: 1_704_153_600,
  updated_by: 'updater-id',
  ...overrides,
})

describe('SnippetCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render updater name and updated time from member data', () => {
      render(<SnippetCard snippet={createSnippet()} />)

      expect(screen.getByText('Tone Rewriter')).toBeInTheDocument()
      expect(screen.getByText('Updater')).toBeInTheDocument()
      expect(screen.getByText('formatted-time')).toBeInTheDocument()
      expect(screen.queryByText('snippet.usageCount:{"count":19}')).not.toBeInTheDocument()
      expect(screen.queryByText('Creator')).not.toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('should fall back to creator name when updater is unavailable', () => {
      render(<SnippetCard snippet={createSnippet({ updated_by: 'missing-user' })} />)

      expect(screen.getByText('Creator')).toBeInTheDocument()
      expect(screen.getByText('formatted-time')).toBeInTheDocument()
    })

    it('should not render draft status for unpublished snippets', () => {
      render(<SnippetCard snippet={createSnippet({ is_published: false })} />)

      expect(screen.queryByText('snippet.draft')).not.toBeInTheDocument()
    })

    it('should render supported operations only', async () => {
      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'snippet.menu.exportSnippet' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'snippet.menu.deleteSnippet' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /duplicate/i })).not.toBeInTheDocument()
    })

    it('should export a snippet from the operations menu', async () => {
      mockExportMutateAsync.mockResolvedValue('snippet-yaml')

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.exportSnippet' }))

      await waitFor(() => {
        expect(mockExportMutateAsync).toHaveBeenCalledWith({ snippetId: 'snippet-1' })
        expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
          fileName: 'Tone Rewriter.yml',
        }))
      })
    })

    it('should update snippet info from the operations menu', async () => {
      mockUpdateMutate.mockImplementation((_payload, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      })

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }))
      fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
        target: { value: 'Updated Snippet' },
      })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(mockUpdateMutate).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
          body: {
            name: 'Updated Snippet',
            description: 'Rewrites rough drafts.',
          },
        }, expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }))
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should delete a snippet from the operations menu', async () => {
      mockDeleteMutate.mockImplementation((_payload, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      })

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }))
      fireEvent.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      await waitFor(() => {
        expect(mockDeleteMutate).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
        }, expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }))
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })
  })
})
