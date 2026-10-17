import type { SnippetListItem } from '@/types/snippet'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SnippetCard from '../snippet-card'

const {
  deleteSnippet,
  mockDownloadBlob,
  exportSnippet,
  mockOnRefresh,
  mockRenderTagSelector,
  mockWorkspacePermissionKeys,
  mockToastError,
  mockToastSuccess,
  updateSnippet,
} = vi.hoisted(() => ({
  deleteSnippet: vi.fn(),
  mockDownloadBlob: vi.fn(),
  exportSnippet: vi.fn(),
  mockWorkspacePermissionKeys: vi.fn(() => ['snippets.create_and_modify', 'snippets.management']),
  mockOnRefresh: vi.fn(),
  mockRenderTagSelector: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  updateSnippet: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: {
      workspaces: {
        current: {
          customizedSnippets: {
            bySnippetId: {
              patch: updateSnippet,
              delete: deleteSnippet,
              export: { get: exportSnippet },
            },
          },
        },
      },
    },
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': async () => ({
        accounts: [
          {
            id: 'creator-id',
            name: 'Creator',
            email: 'creator@example.com',
            avatar: '',
            avatar_url: null,
            role: 'editor',
            last_login_at: '',
            created_at: '',
            status: 'active',
          },
          {
            id: 'updater-id',
            name: 'Updater',
            email: 'updater@example.com',
            avatar: '',
            avatar_url: null,
            role: 'editor',
            last_login_at: '',
            created_at: '',
            status: 'active',
          },
        ],
      }),
    }),
  }
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})

vi.mock('@/utils/time', () => ({
  formatTime: () => 'formatted-time',
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mockDownloadBlob,
}))

vi.mock('@/app/notifications', () => ({
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
    contextLabel?: string
  }) => {
    mockRenderTagSelector(props)
    const { onOpenTagManagement, onTagsChange, value } = props

    return (
      <div data-testid="snippet-tags">
        <span>{value.map((tag) => tag.name).join(', ')}</span>
        <button type="button" onClick={onOpenTagManagement}>
          manage tags
        </button>
        <button type="button" onClick={onTagsChange}>
          sync tags
        </button>
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
    updateSnippet.mockReset().mockResolvedValue(createSnippet())
    deleteSnippet.mockReset().mockResolvedValue({ result: 'success' })
    exportSnippet.mockReset().mockResolvedValue('snippet-yaml')
    mockWorkspacePermissionKeys.mockReturnValue([
      'snippets.create_and_modify',
      'snippets.management',
    ])
  })

  describe('Rendering', () => {
    it('should render updater name and updated time from member data', async () => {
      render(<SnippetCard snippet={createSnippet()} />)

      expect(screen.getByText('Tone Rewriter')).toBeInTheDocument()
      expect(await screen.findByText('Updater')).toBeInTheDocument()
      expect(screen.getByText('formatted-time')).toBeInTheDocument()
      expect(screen.queryByText('snippet.usageCount:{"count":19}')).not.toBeInTheDocument()
      expect(screen.queryByText('Creator')).not.toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('should fall back to creator name when updater is unavailable', async () => {
      render(<SnippetCard snippet={createSnippet({ updated_by: 'missing-user' })} />)

      expect(await screen.findByText('Creator')).toBeInTheDocument()
      expect(screen.getByText('formatted-time')).toBeInTheDocument()
    })

    it('should fall back to unknown user when creator and updater are unavailable', () => {
      render(
        <SnippetCard
          snippet={createSnippet({ created_by: 'missing-creator', updated_by: 'missing-updater' })}
        />,
      )

      expect(screen.getByText('snippet.unknownUser')).toBeInTheDocument()
    })

    it('should not render draft status for unpublished snippets', () => {
      render(<SnippetCard snippet={createSnippet({ is_published: false })} />)

      expect(screen.queryByText('snippet.draft')).not.toBeInTheDocument()
    })

    it('should render supported operations only', async () => {
      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )

      expect(
        await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'snippet.menu.exportSnippet' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /duplicate/i })).not.toBeInTheDocument()
    })

    it('should hide operations for users without snippet permissions', () => {
      mockWorkspacePermissionKeys.mockReturnValue([])

      render(<SnippetCard snippet={createSnippet()} />)

      expect(
        screen.queryByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      ).not.toBeInTheDocument()
    })

    it('should show edit info with create-and-modify permission without management actions', async () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )

      expect(
        await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'snippet.menu.exportSnippet' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }),
      ).not.toBeInTheDocument()
    })

    it('should show delete with snippet management permission without create-and-modify actions', async () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )

      expect(
        screen.queryByRole('menuitem', { name: 'snippet.menu.editInfo' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: 'snippet.menu.exportSnippet' }),
      ).not.toBeInTheDocument()
      expect(
        await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }),
      ).toBeInTheDocument()
    })

    it('should pass snippet management permission to tag binding capability', () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])

      render(<SnippetCard snippet={createSnippet()} />)

      expect(mockRenderTagSelector).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'snippet',
          targetId: 'snippet-1',
          contextLabel: 'Tone Rewriter',
          canBindOrUnbindTags: true,
        }),
      )
    })

    it('should disable tag binding capability without snippet management permission', () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])

      render(<SnippetCard snippet={createSnippet()} />)

      expect(mockRenderTagSelector).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'snippet',
          targetId: 'snippet-1',
          canBindOrUnbindTags: false,
        }),
      )
    })

    it('should forward tag selector actions without navigating the card link', () => {
      const onOpenTagManagement = vi.fn()
      const onTagsChange = vi.fn()

      render(
        <SnippetCard
          snippet={createSnippet({
            tags: [{ id: 'tag-1', name: 'Sales', type: 'snippet', binding_count: '' }],
          })}
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
      exportSnippet.mockResolvedValue('snippet-yaml')

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.exportSnippet' }))

      await waitFor(() => {
        expect(exportSnippet).toHaveBeenCalledWith({
          params: { snippet_id: 'snippet-1' },
          query: { include_secret: 'false', workflow_id: undefined },
        })
        expect(mockDownloadBlob).toHaveBeenCalledWith(
          expect.objectContaining({
            fileName: 'Tone Rewriter.yml',
          }),
        )
      })
    })

    it('should show an error toast when snippet export fails', async () => {
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
      exportSnippet.mockRejectedValue(new Error('export failed'))

      render(<SnippetCard snippet={createSnippet()} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.exportSnippet' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('snippet.exportFailed')
      })
      expect(mockDownloadBlob).not.toHaveBeenCalled()
    })

    it('should update snippet info from the operations menu', async () => {
      updateSnippet.mockResolvedValue(createSnippet())

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }))
      fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
        target: { value: 'Updated Snippet' },
      })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(updateSnippet).toHaveBeenCalledWith({
          params: { snippet_id: 'snippet-1' },
          body: {
            name: 'Updated Snippet',
            description: 'Rewrites rough drafts.',
          },
        })
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should show update errors without refreshing the list', async () => {
      updateSnippet.mockRejectedValue(new Error('Update failed'))

      render(<SnippetCard snippet={createSnippet({ description: '' })} onRefresh={mockOnRefresh} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }))
      fireEvent.change(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), {
        target: { value: 'Updated Snippet' },
      })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

      await waitFor(() => {
        expect(updateSnippet).toHaveBeenCalledWith(
          expect.objectContaining({
            body: {
              name: 'Updated Snippet',
              description: '',
            },
          }),
        )
        expect(mockToastError).toHaveBeenCalledWith('Update failed')
      })
      expect(mockOnRefresh).not.toHaveBeenCalled()
    })

    it('should delete a snippet from the operations menu', async () => {
      deleteSnippet.mockResolvedValue({ result: 'success' })

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }))
      fireEvent.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      await waitFor(() => {
        expect(deleteSnippet).toHaveBeenCalledWith({
          params: { snippet_id: 'snippet-1' },
        })
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should show delete errors without refreshing the list', async () => {
      deleteSnippet.mockRejectedValue(new Error('Delete failed'))

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      fireEvent.click(await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }))
      fireEvent.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Delete failed')
      })
      expect(mockOnRefresh).not.toHaveBeenCalled()
    })
  })
})
