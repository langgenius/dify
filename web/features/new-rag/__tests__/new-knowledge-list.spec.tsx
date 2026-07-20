import type { KnowledgeSpaceList } from '@dify/contracts/knowledge-fs/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { NewKnowledgeList } from '../new-knowledge-list'

const routerPushMock = vi.hoisted(() => vi.fn())
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

const permissionStateMock = vi.hoisted(() => ({
  workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
  workspacePermissionKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
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
        infiniteOptions: vi.fn(() => ({})),
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

    renderWithNuqs(<NewKnowledgeList viewSwitcher={<div>views</div>} />)

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  })

  it('renders only real knowledge-space metadata and filters with URL-backed search', async () => {
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

    const { onUrlUpdate } = renderWithNuqs(<NewKnowledgeList viewSwitcher={<div>views</div>} />)
    const list = screen.getByRole('list', { name: 'dataset.knowledge' })
    expect(within(list).getByText('Support knowledge')).toBeInTheDocument()
    expect(within(list).getByText('Engineering handbook')).toBeInTheDocument()
    expect(within(list).getByText('Answers for customer support')).toBeInTheDocument()
    expect(within(list).getByText('dataset.newKnowledge.noDescription')).toBeInTheDocument()
    expect(within(list).queryByText('dataset.chunkingMode.general')).not.toBeInTheDocument()
    expect(within(list).queryByText('support')).not.toBeInTheDocument()
    expect(within(list).queryByText('knowledge')).not.toBeInTheDocument()
    expect(within(list).queryByText('—')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'support' } })

    expect(within(list).getByText('Support knowledge')).toBeInTheDocument()
    expect(within(list).queryByText('Engineering handbook')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ searchParams: expect.any(URLSearchParams) }),
      )
    })
  })

  it('renders unsupported metadata filters as disabled controls', async () => {
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

    renderWithNuqs(<NewKnowledgeList viewSwitcher={<div>views</div>} />)

    await user.click(screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
    expect(externalApiPanelMock.setOpen).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'dataset.serviceApi.title' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.tags' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'dataset.newKnowledge.creators' })).toBeDisabled()
  })

  it('shows the three empty-state creation entries to authorized users', () => {
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList viewSwitcher={<div>views</div>} />)

    expect(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.connectSource / }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.uploadFiles / }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^dataset\.newKnowledge\.startEmpty / }),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.connectSourceDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.uploadFilesDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.startEmptyDescription')).toBeInTheDocument()
    expect(screen.getByText('dataset.firstEmpty.recommended')).toBeInTheDocument()
    expect(screen.getAllByTestId('empty-knowledge-card')).toHaveLength(16)
  })

  it('hides creation entries from read-only users', () => {
    permissionStateMock.workspacePermissionKeys = []
    setResolvedPage()

    renderWithNuqs(<NewKnowledgeList viewSwitcher={<div>views</div>} />)

    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.startEmpty' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.readOnlyEmpty')).toBeInTheDocument()
  })

  it('distinguishes an unavailable integration from a retryable list error', () => {
    queryMock.error = { data: { status: 503 } }
    const { rerender } = renderWithNuqs(<NewKnowledgeList viewSwitcher={<div>views</div>} />)

    expect(screen.getByText('dataset.newKnowledge.unavailableTitle')).toBeInTheDocument()

    queryMock.error = new Error('request failed')
    rerender(<NewKnowledgeList viewSwitcher={<div>views</div>} />)

    expect(screen.getByText('dataset.newKnowledge.errorTitle')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(queryMock.refetch).toHaveBeenCalledOnce()
  })

  it('shows one retry action when loading the next page fails', () => {
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

    renderWithNuqs(<NewKnowledgeList viewSwitcher={<div>views</div>} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(queryMock.fetchNextPage).toHaveBeenCalledOnce()
  })
})
