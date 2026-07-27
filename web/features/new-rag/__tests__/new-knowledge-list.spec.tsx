import type { InfiniteData } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { NewKnowledgeList } from '../new-knowledge-list'

type KnowledgeSpaceList = {
  items: Array<{
    createdAt: string
    description?: string
    iconRef?: string
    id: string
    name: string
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
      limit: number
      page: number
    }
  }
}

const externalApiPanelMock = vi.hoisted(() => ({
  open: false,
  setOpen: vi.fn(),
}))
const toastInfoMock = vi.hoisted(() => vi.fn())
const knowledgeSpaceApiResponse = vi.hoisted(
  () => (space: KnowledgeSpaceList['items'][number]) => ({
    control_space_id: space.id,
    created_at: space.createdAt,
    knowledge_space_id: space.id,
    owner_account_id: 'account-1',
    permission_keys: ['knowledge_space_read'],
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
  toast: { info: toastInfoMock },
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
  infiniteOptions: vi.fn((_options: ListKnowledgeSpacesInfiniteOptions) => ({})),
}))

const permissionStateMock = vi.hoisted(() => ({
  workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
  workspacePermissionKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))

vi.mock('@/context/external-api-panel-context', () => ({
  useExternalApiPanel: () => ({
    showExternalApiPanel: externalApiPanelMock.open,
    setShowExternalApiPanel: externalApiPanelMock.setOpen,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiBaseUrl: () => ({ data: { api_base_url: 'https://api.example.com' } }),
}))

vi.mock('@/app/components/datasets/extra-info/service-api', () => ({
  default: () => <button type="button">dataset.serviceApi.title</button>,
}))

vi.mock('@/app/components/datasets/external-api/external-api-panel', () => ({
  default: () => <div>external API panel</div>,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
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
  }
})

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: (atom: unknown) => {
      if (atom === permissionStateMock.workspacePermissionKeysAtom)
        return permissionStateMock.workspacePermissionKeys
      return original.useAtomValue(atom as Parameters<typeof original.useAtomValue>[0])
    },
  }
})

vi.mock('@/context/permission-state', () => ({
  workspacePermissionKeysAtom: permissionStateMock.workspacePermissionKeysAtom,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        get: {
          infiniteOptions: consoleQueryMock.infiniteOptions,
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
    externalApiPanelMock.open = false
    queryMock.data = undefined
    queryMock.error = null
    queryMock.hasNextPage = false
    queryMock.isFetchNextPageError = false
    queryMock.isFetchingNextPage = false
    queryMock.isPending = false
    permissionStateMock.workspacePermissionKeys = [
      'dataset.create_and_management',
      'dataset.external.connect',
    ]
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
    expect(supportCard).toHaveAttribute('href', '/datasets/new/space-1/sources')
    expect(supportCard).toBeInTheDocument()
    expect(
      within(list).getByRole('link', {
        name: 'Engineering handbook',
      }),
    ).toHaveAttribute('href', '/datasets/new/space-2/sources')
    expect(within(list).getByText('Answers for customer support')).toBeInTheDocument()
    expect(within(list).getByText('dataset.newKnowledge.noDescription')).toBeInTheDocument()
    expect(within(supportCard).getByLabelText('camera')).toBeInTheDocument()
    expect(within(list).getAllByText('dataset.newKnowledge.cardType')).toHaveLength(2)
    expect(within(list).getAllByText('dataset.newKnowledge.tags')).toHaveLength(2)
    expect(within(supportCard).getByText('12')).toBeInTheDocument()
    expect(within(list).getByText('0')).toBeInTheDocument()
    expect(within(list).getAllByText('dataset.newKnowledge.appsUnavailable')).toHaveLength(2)
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps backend-dependent metadata filters interactive and filters loaded items by search', async () => {
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

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
    expect(externalApiPanelMock.setOpen).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'dataset.serviceApi.title' })).toBeInTheDocument()

    const tags = screen.getByRole('button', { name: 'dataset.newKnowledge.tags' })
    const creators = screen.getByRole('button', { name: 'dataset.newKnowledge.creators' })
    const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
    const create = screen.getByRole('link', { name: 'common.operation.create' })

    expect(tags).toBeEnabled()
    expect(creators).toBeEnabled()
    await user.click(tags)
    expect(toastInfoMock).toHaveBeenCalledWith('dataset.newKnowledge.filtersUnavailable')
    expect(search).toBeEnabled()
    expect(create).toHaveAttribute('href', '/datasets/new/create')

    await user.type(search, 'customer support')
    expect(screen.getByText('Support knowledge')).toBeInTheDocument()
    expect(screen.queryByText('Engineering handbook')).not.toBeInTheDocument()
  })

  it('keeps stacked creation modes disabled while start empty remains available', () => {
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const connectSource = screen.getByRole('button', {
      name: 'dataset.newKnowledge.connectSource',
    })
    const uploadFiles = screen.getByRole('button', {
      name: 'dataset.newKnowledge.uploadFiles',
    })
    const startEmpty = screen.getByRole('link', {
      name: 'dataset.newKnowledge.startEmpty',
    })

    expect(connectSource).toBeDisabled()
    expect(connectSource).toHaveAccessibleDescription(
      'dataset.newKnowledge.connectSourceDescription dataset.cornerLabel.unavailable dataset.firstEmpty.recommended',
    )
    expect(uploadFiles).toBeDisabled()
    expect(uploadFiles).toHaveAccessibleDescription(
      'dataset.newKnowledge.uploadFilesDescription dataset.cornerLabel.unavailable',
    )
    expect(startEmpty).toHaveAttribute('href', '/datasets/new/create?start=empty')
    expect(startEmpty).toHaveAccessibleDescription('dataset.newKnowledge.startEmptyDescription')
    expect(screen.getByText('dataset.newKnowledge.connectSourceDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.uploadFilesDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.startEmptyDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.firstEmpty.recommended')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-knowledge-card')).not.toBeInTheDocument()
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

  it('keeps full collection pagination available while local search is active', async () => {
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
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    expect(queryMock.fetchNextPage).toHaveBeenCalledOnce()
  })
})
