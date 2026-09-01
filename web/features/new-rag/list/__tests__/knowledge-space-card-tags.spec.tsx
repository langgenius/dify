import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeSpaceCardTags } from '../knowledge-space-card-tags'

const { invalidateQueries, putTags, toastMock } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  putTags: vi.fn(),
  toastMock: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const workspacePermissionKeys = vi.hoisted(() => ({
  value: ['dataset.tag.manage'] as string[],
}))

const tagQuery = vi.hoisted(() => ({
  data: [] as Tag[],
}))

const knowledgeTags: Tag[] = [
  { binding_count: '1', id: 'tag-1', name: 'Frontend', type: 'knowledge' },
  { binding_count: '1', id: 'tag-2', name: 'Backend', type: 'knowledge' },
  { binding_count: '0', id: 'tag-3', name: 'Public docs', type: 'knowledge' },
]

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: toastMock }))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: workspacePermissionKeys.value,
  }))
})

vi.mock('@/features/tag-management/hooks/use-tag-mutations', () => ({
  useApplyTagBindingsMutation: () => ({ mutate: vi.fn() }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useMutation: (options: {
      mutationFn?: (input: unknown) => Promise<unknown>
      onError?: () => void
      onSettled?: () => void
      onSuccess?: () => void
    }) => ({
      isPending: false,
      mutate: (input: unknown) => {
        Promise.resolve(options.mutationFn?.(input))
          .then(
            () => options.onSuccess?.(),
            () => options.onError?.(),
          )
          .finally(() => options.onSettled?.())
      },
    }),
    useQuery: () => ({ data: tagQuery.data }),
    useQueryClient: () => ({ invalidateQueries }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          tags: {
            put: {
              mutationOptions: () => ({ mutationFn: putTags }),
            },
          },
        },
        get: {
          key: () => ['knowledge-fs', 'spaces'],
        },
      },
    },
    tags: {
      get: {
        key: () => ['tags'],
        queryOptions: () => ({}),
      },
      post: {
        mutationOptions: () => ({ mutationFn: vi.fn() }),
      },
    },
  },
}))

function createKnowledgeSpace(
  permissionKeys: KnowledgeFsSpaceListItemResponse['permission_keys'],
): KnowledgeFsSpaceListItemResponse {
  return {
    control_space_id: 'space-1',
    created_at: '2026-08-13T00:00:00Z',
    knowledge_space_id: 'knowledge-space-1',
    linked_apps: 0,
    owner_account_id: 'account-1',
    permission_keys: permissionKeys,
    resource_version: 1,
    state: 'active',
    tags: [
      { id: 'tag-1', name: 'Frontend', type: 'knowledge' },
      { id: 'tag-2', name: 'Backend', type: 'knowledge' },
    ],
    technical_status: 'available',
    technical_summary: {
      description: null,
      document_count: 0,
      icon: null,
      knowledge_space_id: 'knowledge-space-1',
      name: 'Public docs',
      revision: 1,
      slug: 'public-docs',
    },
    updated_at: '2026-08-13T00:00:00Z',
    visibility: 'only_me',
  }
}

describe('KnowledgeSpaceCardTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    putTags.mockResolvedValue({ data: [] })
    invalidateQueries.mockResolvedValue(undefined)
    workspacePermissionKeys.value = ['dataset.tag.manage']
    tagQuery.data = knowledgeTags
  })

  it('shows tags returned with the knowledge space', () => {
    tagQuery.data = []
    render(
      <KnowledgeSpaceCardTags
        knowledgeSpace={createKnowledgeSpace(['knowledge_space_read'])}
        onOpenTagManagement={vi.fn()}
      />,
    )

    expect(screen.getByText('Frontend')).toBeInTheDocument()
    expect(screen.getByText('Backend')).toBeInTheDocument()
  })

  it('submits the final tag set and refreshes the list and binding counts', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeSpaceCardTags
        knowledgeSpace={createKnowledgeSpace(['knowledge_space_edit', 'knowledge_space_read'])}
        onOpenTagManagement={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Frontend, Backend: Public docs' })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Frontend' }))
    await user.click(screen.getByRole('option', { name: 'Public docs' }))
    await user.click(trigger)

    await waitFor(() => {
      expect(putTags).toHaveBeenCalledWith({
        body: { tag_ids: ['tag-2', 'tag-3'] },
        params: { control_space_id: 'space-1' },
      })
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['knowledge-fs', 'spaces'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tags'] })
    expect(toastMock.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
  })

  it('can clear every tag from an editable knowledge space', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeSpaceCardTags
        knowledgeSpace={createKnowledgeSpace(['knowledge_space_edit', 'knowledge_space_read'])}
        onOpenTagManagement={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Frontend, Backend: Public docs' })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Frontend' }))
    await user.click(screen.getByRole('option', { name: 'Backend' }))
    await user.click(trigger)

    await waitFor(() => {
      expect(putTags).toHaveBeenCalledWith({
        body: { tag_ids: [] },
        params: { control_space_id: 'space-1' },
      })
    })
  })

  it('does not allow binding changes without space edit permission', () => {
    render(
      <KnowledgeSpaceCardTags
        knowledgeSpace={createKnowledgeSpace(['knowledge_space_read'])}
        onOpenTagManagement={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Frontend, Backend: Public docs' })).toBeDisabled()
    expect(putTags).not.toHaveBeenCalled()
  })
})
