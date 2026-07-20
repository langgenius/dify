import type { KnowledgeSpaceList } from '@dify/contracts/knowledge-fs/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { NewKnowledgeList } from '../new-knowledge-list'

type ListKnowledgeSpacesInfiniteOptions = {
  getNextPageParam: (lastPage: KnowledgeSpaceList) => string | undefined
  initialPageParam: string | null
  input: (pageParam: unknown) => {
    query: {
      cursor?: string
      limit: number
    }
  }
}

const externalApiPanelMock = vi.hoisted(() => ({
  open: false,
  setOpen: vi.fn(),
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
    useInfiniteQuery: () => queryMock,
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
      listKnowledgeSpaces: {
        infiniteOptions: consoleQueryMock.infiniteOptions,
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
    expect(options?.initialPageParam).toBeNull()
    expect(options?.input(null)).toEqual({ query: { limit: 30 } })
    expect(options?.input('next-page')).toEqual({
      query: { cursor: 'next-page', limit: 30 },
    })
    expect(options?.getNextPageParam({ items: [], nextCursor: 'next-page' })).toBe('next-page')
    expect(options?.getNextPageParam({ items: [] })).toBeUndefined()
  })

  it('renders real knowledge spaces as unavailable until the detail contract is supported', () => {
    setResolvedPage([
      {
        createdAt: '2026-07-15T00:00:00Z',
        description: 'Answers for customer support',
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
    const supportCard = within(list).getByRole('article', {
      name: 'Support knowledge. dataset.cornerLabel.unavailable',
    })
    expect(supportCard).toBeInTheDocument()
    expect(
      within(list).getByRole('article', {
        name: 'Engineering handbook. dataset.cornerLabel.unavailable',
      }),
    ).toBeInTheDocument()
    expect(within(list).getByText('Answers for customer support')).toBeInTheDocument()
    expect(within(list).getByText('dataset.newKnowledge.noDescription')).toBeInTheDocument()
    expect(within(supportCard).getByLabelText('camera')).toBeInTheDocument()
    expect(within(list).getAllByText('dataset.newKnowledge.cardType')).toHaveLength(2)
    expect(within(list).getAllByText('dataset.newKnowledge.tags')).toHaveLength(2)
    expect(within(list).getAllByText('dataset.newKnowledge.documentsUnavailable')).toHaveLength(2)
    expect(within(list).getAllByText('dataset.newKnowledge.appsUnavailable')).toHaveLength(2)
    expect(within(list).queryByRole('link')).not.toBeInTheDocument()
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()
  })

  it('disables unsupported collection search and metadata filters with an accessible reason', async () => {
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

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
    expect(externalApiPanelMock.setOpen).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'dataset.serviceApi.title' })).toBeInTheDocument()

    const tags = screen.getByRole('button', { name: 'dataset.newKnowledge.tags' })
    const creators = screen.getByRole('button', { name: 'dataset.newKnowledge.creators' })
    const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
    const create = screen.getByRole('button', { name: 'common.operation.create' })

    expect(tags).toBeDisabled()
    expect(tags).toHaveAccessibleDescription('dataset.newKnowledge.filtersUnavailable')
    expect(creators).toBeDisabled()
    expect(creators).toHaveAccessibleDescription('dataset.newKnowledge.filtersUnavailable')
    expect(search).toBeDisabled()
    expect(search).toHaveAccessibleDescription('dataset.newKnowledge.filtersUnavailable')
    expect(create).toBeDisabled()
    expect(create).toHaveAccessibleDescription('dataset.cornerLabel.unavailable')

    const filterReason = screen.getByRole('button', {
      name: 'dataset.newKnowledge.filtersUnavailable',
    })
    await user.click(filterReason)
    expect(
      await screen.findByRole('dialog', {
        name: 'dataset.newKnowledge.filtersUnavailable',
      }),
    ).toBeInTheDocument()
  })

  it('shows unavailable empty-state creation entries to authorized users', () => {
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    const connectSource = screen.getByRole('button', {
      name: 'dataset.newKnowledge.connectSource',
    })
    const uploadFiles = screen.getByRole('button', {
      name: 'dataset.newKnowledge.uploadFiles',
    })
    const startEmpty = screen.getByRole('button', {
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
    expect(startEmpty).toBeDisabled()
    expect(startEmpty).toHaveAccessibleDescription(
      'dataset.newKnowledge.startEmptyDescription dataset.cornerLabel.unavailable',
    )
    expect(screen.getByText('dataset.newKnowledge.connectSourceDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.uploadFilesDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.startEmptyDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.firstEmpty.recommended')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-knowledge-card')).not.toBeInTheDocument()
  })

  it('hides creation entries from read-only users', () => {
    permissionStateMock.workspacePermissionKeys = []
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />)

    expect(
      screen.queryByRole('button', { name: /^dataset\.newKnowledge\.startEmpty/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /common\.operation\.create/ }),
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

  it('keeps full collection pagination available while collection search is disabled', async () => {
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

    renderWithNuqs(<NewKnowledgeList view="new" onViewChange={vi.fn()} />, {
      searchParams: '?q=missing',
    })

    expect(screen.getByText('Support knowledge')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dataset.newKnowledge.loadMore' }))
    expect(queryMock.fetchNextPage).toHaveBeenCalledOnce()
  })
})
