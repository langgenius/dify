import type { SnippetListItem } from '@/types/snippet'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SnippetCard from '../snippet-card'

const {
  deleteSnippet,
  mockDownloadBlob,
  exportSnippet,
  mockOnRefresh,
  bindTags,
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
  bindTags: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  updateSnippet: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.bySnippetId.patch': updateSnippet,
      'workspaces.current.customizedSnippets.bySnippetId.delete': deleteSnippet,
      'workspaces.current.customizedSnippets.bySnippetId.export.get': exportSnippet,
      'tagBindings.post': bindTags,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'tags.get': async () => [{ id: 'tag-1', name: 'Sales', type: 'snippet', binding_count: '0' }],
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
    vi.resetAllMocks()
    bindTags.mockResolvedValue({ result: 'success' })
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
      expect(screen.queryByText('Creator')).not.toBeInTheDocument()
    })

    it('should fall back to creator name when updater is unavailable', async () => {
      render(<SnippetCard snippet={createSnippet({ updated_by: 'missing-user' })} />)

      expect(await screen.findByText('Creator')).toBeInTheDocument()
      expect(screen.getByText('formatted-time')).toBeInTheDocument()
    })

    it('should fall back to unknown user when creator and updater are unavailable', async () => {
      const { queryClient } = render(
        <SnippetCard
          snippet={createSnippet({ created_by: 'missing-creator', updated_by: 'missing-updater' })}
        />,
      )

      await waitFor(() => expect(queryClient.isFetching()).toBe(0))
      expect(screen.getByText('snippet.unknownUser')).toBeInTheDocument()
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
      const user = userEvent.setup()
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])

      render(<SnippetCard snippet={createSnippet()} />)

      await user.click(
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
      const user = userEvent.setup()
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])

      render(<SnippetCard snippet={createSnippet()} />)

      await user.click(
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

    it('should export a snippet from the operations menu', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
      exportSnippet.mockResolvedValue('snippet-yaml')

      render(<SnippetCard snippet={createSnippet()} />)

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'snippet.menu.exportSnippet' }))

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
      const user = userEvent.setup()
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
      exportSnippet.mockRejectedValue(new Error('export failed'))

      render(<SnippetCard snippet={createSnippet()} />)

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'snippet.menu.exportSnippet' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('snippet.exportFailed')
      })
      expect(mockDownloadBlob).not.toHaveBeenCalled()
    })

    it('should update snippet info from the operations menu', async () => {
      const user = userEvent.setup()
      updateSnippet.mockResolvedValue(createSnippet())

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }))
      await user.clear(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'))
      await user.type(
        screen.getByPlaceholderText('workflow.snippet.namePlaceholder'),
        'Updated Snippet',
      )
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

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
      const user = userEvent.setup()
      updateSnippet.mockRejectedValue(new Error('Update failed'))

      render(<SnippetCard snippet={createSnippet({ description: '' })} onRefresh={mockOnRefresh} />)

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'snippet.menu.editInfo' }))
      await user.clear(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'))
      await user.type(
        screen.getByPlaceholderText('workflow.snippet.namePlaceholder'),
        'Updated Snippet',
      )
      await user.click(screen.getByRole('button', { name: /common\.operation\.save/i }))

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
      const user = userEvent.setup()
      deleteSnippet.mockResolvedValue({ result: 'success' })

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }))
      await user.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      await waitFor(() => {
        expect(deleteSnippet).toHaveBeenCalledWith({
          params: { snippet_id: 'snippet-1' },
        })
        expect(mockOnRefresh).toHaveBeenCalled()
      })
    })

    it('should show delete errors without refreshing the list', async () => {
      const user = userEvent.setup()
      deleteSnippet.mockRejectedValue(new Error('Delete failed'))

      render(<SnippetCard snippet={createSnippet()} onRefresh={mockOnRefresh} />)

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.moreActionsFor:{"name":"Tone Rewriter"}',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'snippet.menu.deleteSnippet' }))
      await user.click(screen.getByRole('button', { name: 'snippet.menu.deleteSnippet' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Delete failed')
      })
      expect(mockOnRefresh).not.toHaveBeenCalled()
    })
    it('binds a tag to the snippet with management permission and refreshes the owner', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])
      const onTagsChange = vi.fn()
      render(<SnippetCard snippet={createSnippet()} onTagsChange={onTagsChange} />)
      await user.click(screen.getByRole('combobox', { name: 'common.tag.addTag: Tone Rewriter' }))
      await user.click(await screen.findByRole('option', { name: 'Sales' }))
      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(bindTags).toHaveBeenCalledExactlyOnceWith({
          body: { tag_ids: ['tag-1'], target_id: 'snippet-1', type: 'snippet' },
        }),
      )
      await waitFor(() => expect(onTagsChange).toHaveBeenCalledOnce())
    })

    it('prevents tag changes when the user has no snippet permissions', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys.mockReturnValue([])
      render(<SnippetCard snippet={createSnippet()} />)
      const tags = screen.getByRole('combobox', { name: 'common.tag.noTag: Tone Rewriter' })
      expect(tags).toBeDisabled()
      await user.click(tags)
      expect(screen.queryByRole('option', { name: 'Sales' })).not.toBeInTheDocument()
      expect(bindTags).not.toHaveBeenCalled()
    })
  })
})
