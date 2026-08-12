import type { InfiniteData } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { NewKnowledgeList } from '../new-knowledge-list'

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

const consoleQueryMock = vi.hoisted(() => ({
  deleteMutationOptions: vi.fn(() => ({ mutationFn: deleteSpaceMock })),
  infiniteOptions: vi.fn((_options: ListKnowledgeSpacesInfiniteOptions) => ({})),
  listKey: ['knowledge-fs', 'spaces'],
  membersQueryOptions: vi.fn(() => ({})),
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
const accountStateMock = vi.hoisted(() => ({
  userProfileIdAtom: Symbol('userProfileIdAtom'),
  userProfileAtom: Symbol('userProfileAtom'),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiBaseUrl: () => ({ data: { api_base_url: 'https://api.example.com' } }),
}))

vi.mock('@/app/components/datasets/extra-info/service-api', () => ({
  default: () => <button type="button">dataset.serviceApi.title</button>,
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
    useQuery: () => ({ ...membersMock }),
    useQueryClient: () => ({
      invalidateQueries: invalidateQueriesMock,
    }),
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
      if (atom === accountStateMock.userProfileIdAtom) return 'account-1'
      if (atom === accountStateMock.userProfileAtom) return { id: 'account-1' }
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

vi.mock('@/context/account-state', () => ({
  userProfileIdAtom: accountStateMock.userProfileIdAtom,
  userProfileAtom: accountStateMock.userProfileAtom,
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
  },
}))

const setResolvedPage = (items: KnowledgeSpaceList['items'] = []) => {
  queryMock.data = {
    pageParams: [null],
    pages: [{ items }],
  }
}

describe('NewKnowledgeList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMock.data = undefined
    queryMock.error = null
    queryMock.hasNextPage = false
    queryMock.isFetchNextPageError = false
    queryMock.isFetchingNextPage = false
    queryMock.isPending = false
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
    expect(within(supportCard).getByText('12')).toBeInTheDocument()
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

  it('keeps backend-dependent metadata filters interactive and sends search to the collection API', async () => {
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
    expect(toastMock.info).toHaveBeenCalledWith('dataset.newKnowledge.filtersUnavailable')
    expect(search).toBeEnabled()
    expect(create).toHaveAttribute('href', '/datasets/new/create')

    await user.type(search, 'customer support')
    await waitFor(() => {
      const options = consoleQueryMock.infiniteOptions.mock.calls.at(-1)?.[0]
      expect(options?.input(1)).toEqual({
        query: { limit: 30, page: 1, query: 'customer support' },
      })
    })
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('query')).toBe('customer support')
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
