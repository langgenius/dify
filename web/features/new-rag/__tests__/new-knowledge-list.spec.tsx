import type { InfiniteData } from '@tanstack/react-query'
import type { KnowledgeUpgrade } from '../upgrade/knowledge-upgrade-context-value'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { NewKnowledgeList } from '../new-knowledge-list'
import { KnowledgeUpgradeContext } from '../upgrade/knowledge-upgrade-context-value'

type KnowledgeSpaceList = {
  items: Array<{
    createdAt: string
    description?: string
    iconRef?: string
    id: string
    linkedApps?: number
    name: string
    permissionKeys?: Array<
      'knowledge_space_delete' | 'knowledge_space_edit' | 'knowledge_space_read'
    >
    revision: number
    slug: string
    tenantId: string
    tags?: Array<{ id: string; name: string }>
    updatedAt: string
    documentCount?: number
  }>
  nextCursor?: string
}

type ListKnowledgeSpacesInfiniteOptions = {
  getNextPageParam: (lastPage: { has_more: boolean; page: number }) => number | undefined
  initialPageParam: number
  input: (pageParam: unknown) => {
    query: {
      creator_ids?: string[]
      limit: number
      page: number
      query?: string
      tag_ids?: string[]
    }
  }
}

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}))
const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
}))
const deleteSpaceMock = vi.hoisted(() => vi.fn())
const invalidateQueriesMock = vi.hoisted(() => vi.fn())
const knowledgeSpaceApiResponse = vi.hoisted(
  () => (space: KnowledgeSpaceList['items'][number]) => ({
    control_space_id: space.id,
    created_at: space.createdAt,
    knowledge_space_id: space.id,
    linked_apps: space.linkedApps ?? 0,
    owner_account_id: 'account-1',
    permission_keys: space.permissionKeys ?? ['knowledge_space_read'],
    resource_version: space.revision,
    state: 'active',
    tags: space.tags?.map((tag) => ({ ...tag, type: 'knowledge' as const })),
    technical_status: 'available',
    technical_summary: {
      description: space.description ?? null,
      document_count: space.documentCount ?? 0,
      icon: space.iconRef ?? null,
      knowledge_space_id: space.id,
      name: space.name,
      revision: space.revision,
      slug: space.slug,
    },
    updated_at: space.updatedAt,
    visibility: 'only_me',
  }),
)

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

const queryMock = vi.hoisted(() => ({
  data: undefined as InfiniteData<KnowledgeSpaceList> | undefined,
  error: null as unknown,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const upgradeJobsMock = vi.hoisted(() => ({
  data: undefined as
    | {
        data: Array<{
          completed_documents: number
          completed_sources: number
          id: string
          new_control_space_id?: string | null
          old_dataset_id: string
          snapshot_at: string
          stage: 'completed' | 'submitting_documents'
          status: 'failed' | 'queued' | 'running' | 'succeeded'
          total_documents: number
          total_sources: number
        }>
      }
    | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))

const upgradeDatasetsMock = vi.hoisted(() => ({
  data: undefined as
    | {
        data: Array<{
          description: string
          id: string
          knowledge_fs_upgrade: {
            can_retry: boolean
            can_upgrade: boolean
            job?: {
              completed_documents: number
              completed_sources: number
              id: string
              new_control_space_id?: string | null
              old_dataset_id: string
              snapshot_at: string
              stage: 'completed' | 'submitting_documents'
              status: 'failed' | 'queued' | 'running' | 'succeeded'
              total_documents: number
              total_sources: number
            } | null
          }
          name: string
          tags: Array<{ id: string; name: string }>
        }>
      }
    | undefined,
  error: null as unknown,
  isPending: false,
  refetch: vi.fn(),
}))

const consoleQueryMock = vi.hoisted(() => ({
  datasetsKey: ['datasets'],
  datasetsQueryOptions: vi.fn((options: { input: { query: { ids: string[] } } }) => ({
    ...options,
    testQuery: 'upgrade-datasets',
  })),
  deleteMutationOptions: vi.fn(() => ({ mutationFn: deleteSpaceMock })),
  infiniteOptions: vi.fn((_options: ListKnowledgeSpacesInfiniteOptions) => ({})),
  listKey: ['knowledge-fs', 'spaces'],
  membersQueryOptions: vi.fn(() => ({})),
  upgradeJobsQueryOptions: vi.fn(() => ({ testQuery: 'upgrade-jobs' })),
}))

const membersMock = vi.hoisted(() => ({
  data: undefined as
    | {
        accounts: Array<{
          avatar_url: null
          id: string
          name: string
          status: 'active' | 'pending'
        }>
      }
    | undefined,
  isError: false,
  isPending: false,
  refetch: vi.fn(),
}))

const resolvedMembers = {
  accounts: [
    { avatar_url: null, id: 'account-1', name: 'Alice', status: 'active' as const },
    { avatar_url: null, id: 'account-2', name: 'Bob', status: 'active' as const },
    {
      avatar_url: null,
      id: 'account-pending',
      name: 'Pending member',
      status: 'pending' as const,
    },
  ],
}

const permissionStateMock = vi.hoisted(() => ({
  workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
  workspacePermissionKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))
const systemFeaturesStateMock = vi.hoisted(() => ({
  knowledgeFsUploadEnabled: true,
  knowledgeFsUploadEnabledAtom: Symbol('knowledgeFsUploadEnabledAtom'),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiBaseUrl: () => ({ data: { api_base_url: 'https://api.example.com' } }),
}))

vi.mock('@/app/components/datasets/extra-info/service-api', () => ({
  ServiceApi: () => <button type="button">dataset.serviceApi.title</button>,
}))

vi.mock('@/app/components/datasets/external-api/external-api-panel', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      external API panel
      <button type="button" onClick={onClose}>
        close external API panel
      </button>
    </div>
  ),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useMutation: (options: {
      mutationFn: (input: unknown) => Promise<unknown>
      onError?: () => void
      onSuccess?: () => void
    }) => ({
      isPending: false,
      mutate: (input: unknown) => {
        void options.mutationFn(input).then(options.onSuccess, options.onError)
      },
    }),
    useInfiniteQuery: () => ({
      ...queryMock,
      data: queryMock.data
        ? {
            ...queryMock.data,
            pages: queryMock.data.pages.map((page, index) => ({
              data: page.items.map(knowledgeSpaceApiResponse),
              has_more: Boolean(page.nextCursor),
              limit: 30,
              page: index + 1,
            })),
          }
        : undefined,
    }),
    useQueries: ({ queries }: { queries: Array<{ testQuery?: string }> }) =>
      queries.map(() => ({ ...upgradeDatasetsMock })),
    useQuery: (options: { testQuery?: string }) => {
      if (options.testQuery === 'upgrade-jobs') return { ...upgradeJobsMock }
      return { ...membersMock }
    },
    useQueryClient: () => ({
      invalidateQueries: invalidateQueriesMock,
    }),
    useSuspenseQuery: () => ({ data: 'account-1' }),
  }
})

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) => {
      if (atom === permissionStateMock.workspacePermissionKeysAtom)
        return permissionStateMock.workspacePermissionKeys
      if (atom === systemFeaturesStateMock.knowledgeFsUploadEnabledAtom)
        return systemFeaturesStateMock.knowledgeFsUploadEnabled
      return original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0])
    },
  }
})

vi.mock('@/context/permission-state', () => ({
  workspacePermissionKeysAtom: permissionStateMock.workspacePermissionKeysAtom,
}))

vi.mock('@/features/system-features/state', () => ({
  knowledgeFsUploadEnabledAtom: systemFeaturesStateMock.knowledgeFsUploadEnabledAtom,
}))

vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: ({ onChange, value }: { onChange: (value: string[]) => void; value: string[] }) => (
    <button
      type="button"
      aria-label="dataset.newKnowledge.tags"
      onClick={() => onChange(value.length ? [] : ['tag-1', 'tag-2'])}
    >
      dataset.newKnowledge.tags
    </button>
  ),
}))

vi.mock('@/features/tag-management/components/tag-management-modal', () => ({
  TagManagementModal: () => null,
}))

vi.mock('../components/knowledge-space-card-tags', () => ({
  KnowledgeSpaceCardTags: ({
    knowledgeSpace,
  }: {
    knowledgeSpace: { tags?: Array<{ id: string; name: string }> }
  }) => (
    <div>
      <span>dataset.newKnowledge.tags</span>
      {knowledgeSpace.tags?.map((tag) => tag.name).join(', ')}
    </div>
  ),
}))

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({}),
}))

vi.mock('../upgrade/knowledge-upgrade-card', () => ({
  KnowledgeUpgradeCard: ({
    upgrade,
  }: {
    upgrade: {
      canRetry: boolean
      dataset: { id: string }
      job: { id: string; status: string }
    }
  }) => (
    <li>
      {`upgrade:${upgrade.dataset.id}:${upgrade.job.id}:${upgrade.job.status}`}
      {upgrade.canRetry && <button type="button">{`retry:${upgrade.job.id}`}</button>}
    </li>
  ),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        members: {
          get: {
            queryOptions: consoleQueryMock.membersQueryOptions,
          },
        },
      },
    },
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          delete: {
            mutationOptions: consoleQueryMock.deleteMutationOptions,
          },
        },
        get: {
          infiniteOptions: consoleQueryMock.infiniteOptions,
          key: () => consoleQueryMock.listKey,
        },
      },
    },
    datasets: {
      get: {
        key: () => consoleQueryMock.datasetsKey,
        queryOptions: consoleQueryMock.datasetsQueryOptions,
      },
      knowledgeFsUpgradeJobs: {
        get: {
          queryOptions: consoleQueryMock.upgradeJobsQueryOptions,
        },
      },
    },
  },
}))

const setResolvedPage = (items: KnowledgeSpaceList['items'] = []) => {
  queryMock.data = {
    pageParams: [null],
    pages: [{ items }],
  }
}

const createUpgradeJob = (
  overrides: Partial<NonNullable<typeof upgradeJobsMock.data>['data'][number]> = {},
): NonNullable<typeof upgradeJobsMock.data>['data'][number] => ({
  completed_documents: 4,
  completed_sources: 1,
  id: 'upgrade-1',
  old_dataset_id: 'dataset-1',
  snapshot_at: '2026-08-18T00:00:00Z',
  stage: 'submitting_documents',
  status: 'running',
  total_documents: 10,
  total_sources: 1,
  ...overrides,
})

describe('NewKnowledgeList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMock.data = undefined
    queryMock.error = null
    queryMock.hasNextPage = false
    queryMock.isFetchNextPageError = false
    queryMock.isFetchingNextPage = false
    queryMock.isPending = false
    upgradeJobsMock.data = undefined
    upgradeJobsMock.error = null
    upgradeJobsMock.isPending = false
    upgradeJobsMock.refetch.mockResolvedValue(undefined)
    upgradeDatasetsMock.data = undefined
    upgradeDatasetsMock.error = null
    upgradeDatasetsMock.isPending = false
    upgradeDatasetsMock.refetch.mockResolvedValue(undefined)
    membersMock.data = resolvedMembers
    membersMock.isError = false
    membersMock.isPending = false
    membersMock.refetch.mockResolvedValue(undefined)
    deleteSpaceMock.mockResolvedValue(undefined)
    invalidateQueriesMock.mockResolvedValue(undefined)
    permissionStateMock.workspacePermissionKeys = [
      'dataset.create_and_management',
      'dataset.external.connect',
    ]
    systemFeaturesStateMock.knowledgeFsUploadEnabled = true
  })

  it('shows a scoped loading state', () => {
    queryMock.isPending = true

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  })

  it('keeps the empty workspace loading while upgrade datasets are being restored', () => {
    setResolvedPage()
    upgradeJobsMock.data = { data: [createUpgradeJob()] }
    upgradeDatasetsMock.isPending = true

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('dataset.newKnowledge.emptyTitle')).not.toBeInTheDocument()
  })

  it('shows and retries an upgrade recovery error', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    upgradeJobsMock.data = { data: [createUpgradeJob()] }
    upgradeDatasetsMock.error = new Error('Failed to restore upgrade datasets')

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'dataset.newKnowledge.errorTitle' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(upgradeJobsMock.refetch).toHaveBeenCalledOnce()
    expect(upgradeDatasetsMock.refetch).toHaveBeenCalledOnce()
  })

  it('batches legacy dataset lookups to keep each recovery URL bounded', () => {
    setResolvedPage()
    const jobs = Array.from({ length: 51 }, (_, index) =>
      createUpgradeJob({
        id: `upgrade-${index}`,
        old_dataset_id: `dataset-${index}`,
      }),
    )
    upgradeJobsMock.data = { data: jobs }
    upgradeDatasetsMock.data = { data: [] }

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const requestedIdBatches = consoleQueryMock.datasetsQueryOptions.mock.calls.map(
      ([options]) => options.input.query.ids,
    )
    expect(requestedIdBatches).toHaveLength(2)
    expect(requestedIdBatches.every((datasetIds) => datasetIds.length <= 50)).toBe(true)
    expect(requestedIdBatches.flat()).toEqual(jobs.map((job) => job.old_dataset_id))
  })

  it('limits failed upgrade recovery while retaining bounded dataset lookups', () => {
    setResolvedPage()
    const jobs = Array.from({ length: 101 }, (_, index) =>
      createUpgradeJob({
        id: `upgrade-${index}`,
        old_dataset_id: `dataset-${index}`,
        status: 'failed',
      }),
    )
    upgradeJobsMock.data = { data: jobs }
    upgradeDatasetsMock.data = { data: [] }

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const requestedDatasetIds = consoleQueryMock.datasetsQueryOptions.mock.calls.flatMap(
      ([options]) => options.input.query.ids,
    )
    expect(requestedDatasetIds).toEqual(jobs.slice(0, 100).map((job) => job.old_dataset_id))
  })

  it('requests the generated KnowledgeFS collection contract with cursor pagination', () => {
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
    expect(options).toBeDefined()
    expect(options?.initialPageParam).toBe(1)
    expect(options?.input(1)).toEqual({ query: { limit: 30, page: 1 } })
    expect(options?.input(2)).toEqual({
      query: { limit: 30, page: 2 },
    })
    expect(options?.getNextPageParam({ has_more: true, page: 1 })).toBe(2)
    expect(options?.getNextPageParam({ has_more: false, page: 1 })).toBeUndefined()
  })

  it('restores upgrade tasks by querying their exact legacy dataset IDs', () => {
    setResolvedPage()
    upgradeJobsMock.data = {
      data: [
        {
          completed_documents: 4,
          completed_sources: 1,
          id: 'upgrade-1',
          old_dataset_id: 'dataset-31',
          snapshot_at: '2026-08-18T00:00:00Z',
          stage: 'submitting_documents',
          status: 'failed',
          total_documents: 10,
          total_sources: 1,
        },
      ],
    }
    upgradeDatasetsMock.data = {
      data: [
        {
          description: 'Support articles',
          id: 'dataset-31',
          knowledge_fs_upgrade: {
            can_retry: true,
            can_upgrade: false,
            job: {
              completed_documents: 4,
              completed_sources: 1,
              id: 'upgrade-1',
              old_dataset_id: 'dataset-31',
              snapshot_at: '2026-08-18T00:00:00Z',
              stage: 'submitting_documents',
              status: 'failed',
              total_documents: 10,
              total_sources: 1,
            },
          },
          name: 'Support knowledge',
          tags: [],
        },
      ],
    }

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByText('upgrade:dataset-31:upgrade-1:failed')).toBeInTheDocument()
    expect(consoleQueryMock.upgradeJobsQueryOptions).toHaveBeenCalledOnce()
    expect(consoleQueryMock.datasetsQueryOptions).toHaveBeenCalledWith({
      input: { query: { ids: ['dataset-31'] } },
    })
  })

  it('keeps historical failures for the same dataset distinct by job ID', () => {
    setResolvedPage()
    upgradeJobsMock.data = {
      data: [
        {
          completed_documents: 4,
          completed_sources: 1,
          id: 'upgrade-1',
          old_dataset_id: 'dataset-1',
          snapshot_at: '2026-08-17T00:00:00Z',
          stage: 'submitting_documents',
          status: 'failed',
          total_documents: 10,
          total_sources: 1,
        },
        {
          completed_documents: 6,
          completed_sources: 1,
          id: 'upgrade-2',
          old_dataset_id: 'dataset-1',
          snapshot_at: '2026-08-18T00:00:00Z',
          stage: 'submitting_documents',
          status: 'failed',
          total_documents: 10,
          total_sources: 1,
        },
      ],
    }
    upgradeDatasetsMock.data = {
      data: [
        {
          description: 'Support articles',
          id: 'dataset-1',
          knowledge_fs_upgrade: {
            can_retry: true,
            can_upgrade: false,
            job: upgradeJobsMock.data.data[1],
          },
          name: 'Support knowledge',
          tags: [],
        },
      ],
    }

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByText('upgrade:dataset-1:upgrade-1:failed')).toBeInTheDocument()
    expect(screen.getByText('upgrade:dataset-1:upgrade-2:failed')).toBeInTheDocument()
    expect(consoleQueryMock.datasetsQueryOptions).toHaveBeenCalledWith({
      input: { query: { ids: ['dataset-1'] } },
    })
  })

  it('allows retrying an older failed job after a newer migration succeeds', () => {
    setResolvedPage()
    upgradeJobsMock.data = {
      data: [
        {
          completed_documents: 4,
          completed_sources: 1,
          id: 'upgrade-failed',
          old_dataset_id: 'dataset-1',
          snapshot_at: '2026-08-17T00:00:00Z',
          stage: 'submitting_documents',
          status: 'failed',
          total_documents: 10,
          total_sources: 1,
        },
      ],
    }
    upgradeDatasetsMock.data = {
      data: [
        {
          description: 'Support articles',
          id: 'dataset-1',
          knowledge_fs_upgrade: {
            can_retry: false,
            can_upgrade: true,
            job: {
              completed_documents: 10,
              completed_sources: 1,
              id: 'upgrade-succeeded',
              new_control_space_id: 'space-1',
              old_dataset_id: 'dataset-1',
              snapshot_at: '2026-08-18T00:00:00Z',
              stage: 'completed',
              status: 'succeeded',
              total_documents: 10,
              total_sources: 1,
            },
          },
          name: 'Support knowledge',
          tags: [],
        },
      ],
    }

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'retry:upgrade-failed' })).toBeInTheDocument()
  })

  it('keeps recovery retry eligibility authoritative over a stale local upgrade', () => {
    setResolvedPage()
    const recoveredJob = createUpgradeJob({ status: 'failed' })
    upgradeJobsMock.data = { data: [recoveredJob] }
    upgradeDatasetsMock.data = {
      data: [
        {
          description: 'Support articles',
          id: 'dataset-1',
          knowledge_fs_upgrade: {
            can_retry: false,
            can_upgrade: false,
            job: recoveredJob,
          },
          name: 'Support knowledge',
          tags: [],
        },
      ],
    }
    const localUpgrade = {
      canRetry: true,
      dataset: upgradeDatasetsMock.data.data[0],
      job: recoveredJob,
    } as unknown as KnowledgeUpgrade

    renderWithNuqs(
      <KnowledgeUpgradeContext
        value={{
          dismissUpgrade: vi.fn(),
          enabled: true,
          requestUpgrade: vi.fn(),
          settleUpgrade: vi.fn(),
          upgrades: [localUpgrade],
        }}
      >
        <NewKnowledgeList view="new" onViewChange={vi.fn()} />
      </KnowledgeUpgradeContext>,
    )

    expect(screen.getByText('upgrade:dataset-1:upgrade-1:failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'retry:upgrade-1' })).not.toBeInTheDocument()
  })

  it('keeps a completed local upgrade until its knowledge space is visible', async () => {
    setResolvedPage()
    const dismissUpgrade = vi.fn()
    const localUpgrade = {
      canRetry: false,
      dataset: {
        description: 'Support articles',
        id: 'dataset-1',
        name: 'Support knowledge',
        tags: [],
      },
      job: {
        completed_documents: 10,
        completed_sources: 1,
        id: 'upgrade-1',
        new_control_space_id: 'space-1',
        old_dataset_id: 'dataset-1',
        snapshot_at: '2026-08-18T00:00:00Z',
        stage: 'completed',
        status: 'succeeded',
        total_documents: 10,
        total_sources: 1,
      },
    } as unknown as KnowledgeUpgrade
    const contextValue = {
      dismissUpgrade,
      enabled: true,
      requestUpgrade: vi.fn(),
      settleUpgrade: vi.fn(),
      upgrades: [localUpgrade],
    }
    const { rerender } = renderWithNuqs(
      <KnowledgeUpgradeContext value={contextValue}>
        <NewKnowledgeList view="new" onViewChange={vi.fn()} />
      </KnowledgeUpgradeContext>,
    )

    expect(screen.getByText('upgrade:dataset-1:upgrade-1:succeeded')).toBeInTheDocument()
    expect(dismissUpgrade).not.toHaveBeenCalled()

    upgradeJobsMock.data = {
      data: [
        {
          ...localUpgrade.job,
          completed_documents: 9,
          stage: 'submitting_documents',
          status: 'running',
        },
      ],
    }
    upgradeDatasetsMock.data = {
      data: [
        {
          description: 'Support articles',
          id: 'dataset-1',
          knowledge_fs_upgrade: {
            can_retry: false,
            can_upgrade: false,
            job: upgradeJobsMock.data.data[0],
          },
          name: 'Support knowledge',
          tags: [],
        },
      ],
    }
    setResolvedPage([
      {
        createdAt: '2026-08-18T00:00:00Z',
        id: 'space-1',
        name: 'Upgraded knowledge',
        revision: 1,
        slug: 'upgraded-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-08-18T00:00:00Z',
      },
    ])
    rerender(
      <KnowledgeUpgradeContext value={contextValue}>
        <NewKnowledgeList view="new" onViewChange={vi.fn()} />
      </KnowledgeUpgradeContext>,
    )

    expect(screen.getByRole('link', { name: 'Upgraded knowledge' })).toBeInTheDocument()
    expect(dismissUpgrade).not.toHaveBeenCalled()

    upgradeJobsMock.data = { data: [] }
    rerender(
      <KnowledgeUpgradeContext value={contextValue}>
        <NewKnowledgeList view="new" onViewChange={vi.fn()} />
      </KnowledgeUpgradeContext>,
    )

    await waitFor(() => expect(dismissUpgrade).toHaveBeenCalledWith('upgrade-1'))
  })

  it('keeps an active upgrade card when its control space appears before migration completes', () => {
    setResolvedPage([
      {
        createdAt: '2026-08-18T00:00:00Z',
        id: 'space-1',
        name: 'space-1',
        revision: 1,
        slug: 'space-1',
        tenantId: 'tenant-1',
        updatedAt: '2026-08-18T00:00:00Z',
      },
    ])
    upgradeJobsMock.data = {
      data: [
        {
          completed_documents: 4,
          completed_sources: 1,
          id: 'upgrade-1',
          new_control_space_id: 'space-1',
          old_dataset_id: 'dataset-1',
          snapshot_at: '2026-08-18T00:00:00Z',
          stage: 'submitting_documents',
          status: 'running',
          total_documents: 10,
          total_sources: 1,
        },
      ],
    }
    upgradeDatasetsMock.data = {
      data: [
        {
          description: 'Legacy knowledge',
          id: 'dataset-1',
          knowledge_fs_upgrade: {
            can_retry: false,
            can_upgrade: false,
            job: {
              completed_documents: 4,
              completed_sources: 1,
              id: 'upgrade-1',
              new_control_space_id: 'space-1',
              old_dataset_id: 'dataset-1',
              snapshot_at: '2026-08-18T00:00:00Z',
              stage: 'submitting_documents',
              status: 'running',
              total_documents: 10,
              total_sources: 1,
            },
          },
          name: 'Support knowledge',
          tags: [],
        },
      ],
    }

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByText('upgrade:dataset-1:upgrade-1:running')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'space-1' })).not.toBeInTheDocument()
  })

  it('does not highlight a knowledge space for a historical successful upgrade', () => {
    setResolvedPage([
      {
        createdAt: '2026-08-18T00:00:00Z',
        id: 'space-1',
        name: 'Upgraded knowledge',
        revision: 1,
        slug: 'upgraded-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-08-18T00:00:00Z',
      },
    ])
    upgradeDatasetsMock.data = {
      data: [
        {
          description: 'Legacy knowledge',
          id: 'dataset-1',
          knowledge_fs_upgrade: {
            can_retry: false,
            can_upgrade: false,
            job: {
              completed_documents: 10,
              completed_sources: 1,
              id: 'upgrade-1',
              new_control_space_id: 'space-1',
              old_dataset_id: 'dataset-1',
              snapshot_at: '2026-08-18T00:00:00Z',
              stage: 'completed',
              status: 'succeeded',
              total_documents: 10,
              total_sources: 1,
            },
          },
          name: 'Upgraded knowledge',
          tags: [],
        },
      ],
    }

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Upgraded knowledge' }).closest('li')).not.toHaveClass(
      'border-state-accent-solid',
    )
  })

  it('links real knowledge spaces to the new detail shell', () => {
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        description: 'Answers for customer support',
        documentCount: 12,
        iconRef: 'builtin:camera',
        id: 'space-1',
        name: 'Support knowledge',
        revision: 1,
        slug: 'support-knowledge',
        tags: [
          { id: 'tag-1', name: 'Customer support' },
          { id: 'tag-2', name: 'Public docs' },
        ],
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
      {
        createdAt: '2026-07-16T00:00:00Z',
        id: 'space-2',
        name: 'Engineering handbook',
        revision: 1,
        slug: 'engineering-handbook',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-19T00:00:00Z',
      },
    ])

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)
    const list = screen.getByRole('list', { name: 'dataset.knowledge' })
    const supportCard = within(list).getByRole('link', {
      name: 'Support knowledge',
    })
    const supportCardItem = supportCard.closest('li')
    expect(supportCardItem).not.toBeNull()
    expect(supportCard).toHaveAttribute('href', '/datasets/new/space-1')
    expect(supportCard).toBeInTheDocument()
    expect(
      within(list).getByRole('link', {
        name: 'Engineering handbook',
      }),
    ).toHaveAttribute('href', '/datasets/new/space-2')
    expect(within(list).getByText('Answers for customer support')).toBeInTheDocument()
    expect(within(list).getByText('dataset.newKnowledge.noDescription')).toBeInTheDocument()
    expect(within(supportCard).getByLabelText('camera')).toBeInTheDocument()
    expect(within(list).getAllByText('dataset.newKnowledge.cardType')).toHaveLength(2)
    expect(within(list).getAllByText('dataset.newKnowledge.tags')).toHaveLength(2)
    expect(within(list).getByText('Customer support, Public docs')).toBeInTheDocument()
    expect(within(supportCardItem!).getByText('12')).toBeInTheDocument()
    expect(supportCard).toHaveAccessibleDescription('dataset.newKnowledge.overview.linkedApps: 0')
    expect(
      within(list).getByRole('link', { name: 'Engineering handbook' }),
    ).toHaveAccessibleDescription('dataset.newKnowledge.overview.linkedApps: 0')
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows each knowledge space linked app count from the list response', () => {
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        id: 'space-1',
        linkedApps: 3,
        name: 'Support knowledge',
        revision: 1,
        slug: 'support-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
      {
        createdAt: '2026-07-16T00:00:00Z',
        id: 'space-2',
        linkedApps: 0,
        name: 'Engineering handbook',
        revision: 1,
        slug: 'engineering-handbook',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-19T00:00:00Z',
      },
    ])
    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Support knowledge' })).toHaveAccessibleDescription(
      'dataset.newKnowledge.overview.linkedApps: 3',
    )
    expect(screen.getByRole('link', { name: 'Engineering handbook' })).toHaveAccessibleDescription(
      'dataset.newKnowledge.overview.linkedApps: 0',
    )
  })

  it('shows legacy-style card actions and opens edit settings when permitted', async () => {
    const user = userEvent.setup()
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        id: 'space-1',
        name: 'Support knowledge',
        permissionKeys: ['knowledge_space_delete', 'knowledge_space_edit', 'knowledge_space_read'],
        revision: 1,
        slug: 'support-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
    ])

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const cardLink = screen.getByRole('link', { name: 'Support knowledge' })
    const actions = screen.getByRole('button', { name: 'common.operation.more' })
    expect(cardLink).not.toContainElement(actions)

    await user.click(actions)
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/settings')
  })

  it('requires the exact knowledge name before deleting from the card', async () => {
    const user = userEvent.setup()
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        id: 'space-1',
        name: 'Support knowledge',
        permissionKeys: ['knowledge_space_delete', 'knowledge_space_read'],
        revision: 1,
        slug: 'support-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
    ])

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    const dialog = await screen.findByRole('alertdialog')
    const confirmationInput = within(dialog).getByRole('textbox', {
      name: /^dataset\.newKnowledge\.settings\.deleteConfirmPrompt/,
    })
    const deleteButton = within(dialog).getByRole('button', {
      name: 'common.operation.delete',
    })

    expect(deleteButton).toBeDisabled()
    await user.type(confirmationInput, 'Support')
    expect(deleteButton).toBeDisabled()
    await user.clear(confirmationInput)
    await user.type(confirmationInput, 'Support knowledge')
    await user.click(deleteButton)

    await waitFor(() => {
      expect(deleteSpaceMock).toHaveBeenCalledWith({
        params: { control_space_id: 'space-1' },
      })
    })
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: consoleQueryMock.listKey,
    })
    expect(toastMock.success).toHaveBeenCalledWith('dataset.datasetDeleted')
  })

  it('syncs tag filters to the URL and collection API while keeping search interactive', async () => {
    const user = userEvent.setup()
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        description: 'Answers for customer support',
        id: 'space-1',
        name: 'Support knowledge',
        revision: 1,
        slug: 'support-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
      {
        createdAt: '2026-07-16T00:00:00Z',
        id: 'space-2',
        name: 'Engineering handbook',
        revision: 1,
        slug: 'engineering-handbook',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-19T00:00:00Z',
      },
    ])

    const { onUrlUpdate } = renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
    expect(screen.getByText('external API panel')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'close external API panel' }))
    expect(screen.queryByText('external API panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dataset.serviceApi.title' })).toBeInTheDocument()

    const tags = screen.getByRole('button', { name: 'dataset.newKnowledge.tags' })
    const creators = screen.getByRole('button', { name: 'dataset.newKnowledge.creators' })
    const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
    const create = screen.getByRole('link', { name: 'common.operation.create' })

    expect(tags).toBeEnabled()
    expect(creators).toBeEnabled()
    await user.click(tags)
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('tag_ids')).toBe('tag-1;tag-2')
    })
    let options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
    expect(options?.input(1)).toEqual({
      query: { limit: 30, page: 1, tag_ids: ['tag-1', 'tag-2'] },
    })
    await user.click(tags)
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('tag_ids')).toBe(false)
    })
    expect(search).toBeEnabled()
    expect(create).toHaveAttribute('href', '/datasets/new/create')

    await user.type(search, 'customer support')
    await waitFor(() => {
      options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
      expect(options?.input(1)).toEqual({
        query: { limit: 30, page: 1, query: 'customer support' },
      })
    })
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('query')).toBe('customer support')
  })

  it('restores tag filters from the URL and sends match-any IDs to the collection API', () => {
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />, {
      searchParams: '?tag_ids=tag-1%3Btag-2',
    })

    const options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
    expect(options?.input(1)).toEqual({
      query: { limit: 30, page: 1, tag_ids: ['tag-1', 'tag-2'] },
    })
  })

  it('restores server search from the URL and shows its empty state', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    const { onUrlUpdate } = renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />, {
      searchParams: '?query=no%20matching%20knowledge',
    })

    const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
    expect(search).toHaveValue('no matching knowledge')
    expect(
      screen.getByText('common.operation.noSearchResults:{"content":"dataset.knowledge"}'),
    ).toBeInTheDocument()
    expect(screen.getByText('no matching knowledge')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'dataset.knowledge' })).not.toBeInTheDocument()

    await user.click(screen.getByText('common.operation.clear'))
    expect(search).toHaveValue('')
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('query')).toBe(false)
    })
  })

  it('filters the collection by selected creators and clears the filter', async () => {
    const user = userEvent.setup()
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        id: 'space-1',
        name: 'Support knowledge',
        revision: 1,
        slug: 'support-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
    ])

    const { onUrlUpdate } = renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.creators' }))
    expect(screen.queryByRole('checkbox', { name: /Pending member/ })).not.toBeInTheDocument()
    const creatorSearch = screen.getByRole('textbox', {
      name: 'app.studio.filters.searchCreators',
    })
    await user.type(creatorSearch, 'ali')
    expect(creatorSearch).toHaveValue('ali')
    expect(screen.getByRole('checkbox', { name: /Alice/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Bob/ })).not.toBeInTheDocument()

    await user.clear(creatorSearch)
    await user.click(screen.getByRole('checkbox', { name: /Alice/ }))
    await user.click(screen.getByRole('checkbox', { name: /Bob/ }))

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.creators: 2' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('creator_ids')).toBe(
      'account-1;account-2',
    )

    let options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
    expect(options?.input(1)).toEqual({
      query: { creator_ids: ['account-1', 'account-2'], limit: 30, page: 1 },
    })

    await user.click(screen.getByRole('button', { name: 'app.studio.filters.reset' }))
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('creator_ids')).toBe(false)
    })
    options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
    expect(options?.input(1)).toEqual({ query: { limit: 30, page: 1 } })
  })

  it('restores the creator filter from the URL', () => {
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />, {
      searchParams: '?creator_ids=account-2',
    })

    const options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
    expect(options?.input(1)).toEqual({
      query: { creator_ids: ['account-2'], limit: 30, page: 1 },
    })
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.creators: 1' }),
    ).toBeInTheDocument()
  })

  it('caps creator filters at the API contract limit', async () => {
    const user = userEvent.setup()
    const accounts = Array.from({ length: 101 }, (_, index) => ({
      avatar_url: null,
      id: `account-${index + 1}`,
      name: `Member ${index + 1}`,
      status: 'active' as const,
    }))
    const creatorIdsFromUrl = accounts.map((account) => account.id)
    membersMock.data = { accounts }
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />, {
      searchParams: `?creator_ids=${creatorIdsFromUrl.join(';')}`,
    })

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.creators: 100' }))

    const unselectedCreator = screen.getByRole('checkbox', { name: /Member 101/ })
    expect(unselectedCreator).toHaveAttribute('aria-disabled', 'true')
    expect(unselectedCreator).toHaveAccessibleDescription('dataset.newKnowledge.maxCreators: 100')
    const options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
    expect(options?.input(1).query.creator_ids).toHaveLength(100)
  })

  it('shows creator loading state while workspace members are pending', async () => {
    const user = userEvent.setup()
    membersMock.data = undefined
    membersMock.isPending = true
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.creators' }))
    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('common.noData')).not.toBeInTheDocument()
  })

  it('shows creator loading failure and retries the members request', async () => {
    const user = userEvent.setup()
    membersMock.data = undefined
    membersMock.isError = true
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.creators' }))
    expect(screen.getByRole('alert')).toHaveTextContent('common.error')
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(membersMock.refetch).toHaveBeenCalledOnce()
  })

  it('keeps cached creators available when a background members refresh fails', async () => {
    const user = userEvent.setup()
    membersMock.data = resolvedMembers
    membersMock.isError = true
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.creators' }))
    expect(screen.getByRole('checkbox', { name: /Alice/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('common.error')
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(membersMock.refetch).toHaveBeenCalledOnce()
  })

  it('links available creation modes from the empty state', () => {
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const connectSource = screen.getByRole('link', {
      name: 'dataset.newKnowledge.connectSource',
    })
    const uploadFiles = screen.getByRole('link', {
      name: 'dataset.newKnowledge.uploadFiles',
    })
    const startEmpty = screen.getByRole('link', {
      name: 'dataset.newKnowledge.startEmpty',
    })

    expect(connectSource).toHaveAttribute('href', '/datasets/new/create?start=source')
    expect(connectSource).toHaveAccessibleDescription(
      'dataset.newKnowledge.connectSourceDescription dataset.firstEmpty.recommended',
    )
    expect(uploadFiles).toHaveAttribute('href', '/datasets/new/create?start=upload')
    expect(uploadFiles).toHaveAccessibleDescription('dataset.newKnowledge.uploadFilesDescription')
    expect(startEmpty).toHaveAttribute('href', '/datasets/new/create?start=empty')
    expect(startEmpty).toHaveAccessibleDescription('dataset.newKnowledge.startEmptyDescription')
    expect(screen.getByText('dataset.newKnowledge.connectSourceDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.uploadFilesDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.startEmptyDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.firstEmpty.recommended')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-knowledge-card')).not.toBeInTheDocument()
  })

  it('keeps upload unavailable when KnowledgeFS upload capability is disabled', () => {
    systemFeaturesStateMock.knowledgeFsUploadEnabled = false
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const uploadFiles = screen.getByRole('button', {
      name: 'dataset.newKnowledge.uploadFiles',
    })
    expect(uploadFiles).toBeDisabled()
    expect(uploadFiles).toHaveAccessibleDescription(
      'dataset.newKnowledge.uploadFilesDescription dataset.cornerLabel.unavailable',
    )
  })

  it('does not show the Create route to users with external-connect permission only', () => {
    permissionStateMock.workspacePermissionKeys = ['dataset.external.connect']
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.queryByRole('link', { name: 'common.operation.create' })).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.readOnlyEmpty')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.connectSource' }),
    ).not.toBeInTheDocument()
  })

  it('hides creation entries from read-only users', () => {
    permissionStateMock.workspacePermissionKeys = []
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(
      screen.queryByRole('link', { name: /^dataset\.newKnowledge\.startEmpty/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /common\.operation\.create/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.externalAPIPanelTitle' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('external API panel')).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.readOnlyEmpty')).toBeInTheDocument()
  })

  it.each([404, 503])('shows an unavailable state for a %s response', (status) => {
    queryMock.error = { status }
    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByText('dataset.newKnowledge.unavailableTitle')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  })

  it('shows a retryable error state for other failures', async () => {
    const user = userEvent.setup()
    queryMock.error = new Error('request failed')
    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByText('dataset.newKnowledge.errorTitle')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(queryMock.refetch).toHaveBeenCalledOnce()
  })

  it('shows one retry action when loading the next page fails', async () => {
    const user = userEvent.setup()
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        id: 'space-1',
        name: 'Support knowledge',
        revision: 1,
        slug: 'support-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
    ])
    queryMock.isFetchNextPageError = true

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(queryMock.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps server collection pagination available while search is active', async () => {
    const user = userEvent.setup()
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        id: 'space-1',
        name: 'Support knowledge',
        revision: 1,
        slug: 'support-knowledge',
        tenantId: 'tenant-1',
        updatedAt: '2026-07-18T00:00:00Z',
      },
    ])
    queryMock.hasNextPage = true

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(screen.getByText('Support knowledge')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), 'support')
    await waitFor(() => {
      const options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
      expect(options?.input(1).query.query).toBe('support')
    })
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    expect(queryMock.fetchNextPage).toHaveBeenCalledOnce()
  })
})
