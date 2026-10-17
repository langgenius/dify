import type { KnowledgeFsSpaceListItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { KnowledgeSpaceCardTags } from '../knowledge-space-card-tags'

const { putTags, toastMock } = vi.hoisted(() => ({
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

vi.mock('@/app/notifications', () => ({ toast: toastMock }))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: workspacePermissionKeys.value,
  }))
})

vi.mock('@/features/tag-management/hooks/use-tag-mutations', () => ({
  useApplyTagBindingsMutation: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          tags: {
            put: {
              mutationOptions: () => ({ mutationFn: (input: unknown) => putTags(input) }),
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
        queryOptions: () => ({ queryKey: ['tags'], queryFn: () => tagQuery.data }),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

let queryClient = createTestQueryClient()

function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('KnowledgeSpaceCardTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    putTags.mockResolvedValue({ data: [] })
    workspacePermissionKeys.value = ['dataset.tag.manage']
    tagQuery.data = knowledgeTags
  })

  it('shows tags returned with the knowledge space', () => {
    tagQuery.data = []
    renderWithQuery(
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
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    renderWithQuery(
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
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['knowledge-fs', 'spaces'],
      })
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tags'] })
    expect(toastMock.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
  })

  it('serializes replacements against the latest submitted selection', async () => {
    const user = userEvent.setup()
    const firstReplacement = deferred<{ data: [] }>()
    putTags.mockReturnValueOnce(firstReplacement.promise)
    renderWithQuery(
      <KnowledgeSpaceCardTags
        knowledgeSpace={createKnowledgeSpace(['knowledge_space_edit', 'knowledge_space_read'])}
        onOpenTagManagement={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Frontend, Backend: Public docs' })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Frontend' }))
    await user.click(trigger)
    await waitFor(() => expect(putTags).toHaveBeenCalledOnce())

    const pendingTrigger = screen.getByRole('combobox', { name: 'Backend: Public docs' })
    await user.click(pendingTrigger)
    await user.click(await screen.findByRole('option', { name: 'Public docs' }))
    await user.click(pendingTrigger)

    expect(putTags).toHaveBeenCalledOnce()
    await act(async () => {
      firstReplacement.resolve({ data: [] })
    })

    await waitFor(() => expect(putTags).toHaveBeenCalledTimes(2))
    expect(putTags.mock.calls.map(([input]) => input.body.tag_ids)).toEqual([
      ['tag-2'],
      ['tag-2', 'tag-3'],
    ])
  })

  it('can clear every tag from an editable knowledge space', async () => {
    const user = userEvent.setup()
    renderWithQuery(
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
    renderWithQuery(
      <KnowledgeSpaceCardTags
        knowledgeSpace={createKnowledgeSpace(['knowledge_space_read'])}
        onOpenTagManagement={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Frontend, Backend: Public docs' })).toBeDisabled()
    expect(putTags).not.toHaveBeenCalled()
  })
})
