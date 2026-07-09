import type { SnippetListItem } from '@/types/snippet'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SnippetCard from '../snippet-card'

const {
  mockDeleteMutate,
  mockDownloadBlob,
  mockExportMutateAsync,
  mockOnRefresh,
  mockRenderTagSelector,
  mockIsCurrentWorkspaceEditor,
  mockWorkspacePermissionKeys,
  mockToastError,
  mockToastSuccess,
  mockUpdateMutate,
} = vi.hoisted(() => ({
  mockDeleteMutate: vi.fn(),
  mockDownloadBlob: vi.fn(),
  mockExportMutateAsync: vi.fn(),
  mockIsCurrentWorkspaceEditor: vi.fn(() => true),
  mockWorkspacePermissionKeys: vi.fn(() => ['snippets.create_and_modify', 'snippets.management']),
  mockOnRefresh: vi.fn(),
  mockRenderTagSelector: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockUpdateMutate: vi.fn(),
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

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
  TagSelector: (props: {
    onOpenTagManagement: () => void
    onTagsChange: () => void
    value: Array<{ name: string }>
    canBindOrUnbindTags?: boolean
  }) => {
    mockRenderTagSelector(props)
    const { onOpenTagManagement, onTagsChange, value } = props

    return (
      <div data-testid="snippet-tags">
        <span>{value.map(tag => tag.name).join(', ')}</span>
        <button type="button" onClick={onOpenTagManagement}>manage tags</button>
        <button type="button" onClick={onTagsChange}>sync tags</button>
      </div>
    )
  },
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
  version: overrides.version ?? 1,
})

describe('SnippetCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify', 'snippets.management'])
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

    it('should fall back to unknown user when creator and updater are unavailable', () => {
      render(<SnippetCard snippet={createSnippet({ created_by: 'missing-creator', updated_by: 'missing-updater' })} />)

      expect(screen.getByText('snippet.unknownUser')).toBeInTheDocument()
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

    it('should hide operations for users without snippet permissions', () => {
      mockWorkspacePermissionKeys.mockReturnValue([])

      render(<SnippetCard snippet={createSnippet()} />)

      expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
    })

    it('should show edit info with create-and-modify permission without management actions', async () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'snippet.menu.exportSnippet' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'snippet.menu.deleteSnippet' })).not.toBeInTheDocument()
    })

    it('should show delete with snippet management permission without create-and-modify actions', async () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(screen.queryByRole('menuitem', { name: 'snippet.menu.editInfo' })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'snippet.menu.exportSnippet' })).not.toBeInTheDocument()
      expect(await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' })).toBeInTheDocument()
    })

    it('should pass snippet management permission to tag binding capability', () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])

      render(<SnippetCard snippet={createSnippet()} />)

      expect(mockRenderTagSelector).toHaveBeenCalledWith(expect.objectContaining({
        type: 'snippet',
        targetId: 'snippet-1',
        canBindOrUnbindTags: true,
      }))
    })

    it('should disable tag binding capability without snippet management permission', () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])

      render(<SnippetCard snippet={createSnippet()} />)

      expect(mockRenderTagSelector).toHaveBeenCalledWith(expect.objectContaining({
        type: 'snippet',
        targetId: 'snippet-1',
        canBindOrUnbindTags: false,
      }))
    })

    it('should forward tag selector actions without navigating the card link', () => {
      const onOpenTagManagement = vi.fn()
      const onTagsChange = vi.fn()

      render(
        <SnippetCard
          snippet={createSnippet({ tags: [{ id: 'tag-1', name: 'Sales', type: 'snippet', binding_count: '' }] })}
          onOpenTagManagement={onOpenTagManagement}
          onTagsChange={onTagsChange}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'manage tags' }))
      fireEvent.click(screen.getByRole('button', { name: 'sync tags' }))

      expect(screen.getByText('Sales')).toBeInTheDocument()
      expect(onOpenTagManagement).toHaveBeenCalledTimes(1)
      expect(onTagsChange).toHaveBeenCalledTimes(1)
    })

    it('should export a snippet from the operations menu', async () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
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

    it('should show an error toast when snippet export fails', async () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
      mockExportMutateAsync.mockRejectedValue(new Error('export failed'))

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.exportSnippet' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('snippet.exportFailed')
      })
      expect(mockDownloadBlob).not.toHaveBeenCalled()
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

    it('should show update errors from the mutation callback', async () => {
      mockUpdateMutate.mockImplementation((_payload, options?: { onError?: (error: Error) => void }) => {
        options?.onError?.(new Error('Update failed'))
      })

      render(<SnippetCard snippet={createSnippet({ description: '' })} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }))
      fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
        target: { value: 'Updated Snippet' },
      })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(mockUpdateMutate).toHaveBeenCalledWith(expect.objectContaining({
          body: {
            name: 'Updated Snippet',
            description: '',
          },
        }), expect.any(Object))
        expect(mockToastError).toHaveBeenCalledWith('Update failed')
      })
      expect(mockOnRefresh).not.toHaveBeenCalled()
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

    it('should show delete errors from the mutation callback', async () => {
      mockDeleteMutate.mockImplementation((_payload, options?: { onError?: (error: Error) => void }) => {
        options?.onError?.(new Error('Delete failed'))
      })

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.more' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }))
      fireEvent.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Delete failed')
      })
      expect(mockOnRefresh).not.toHaveBeenCalled()
    })
  })
})
