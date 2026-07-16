import type { KnowledgeSpaceList } from '@dify/contracts/knowledge-fs/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatasetsV2Page } from '../datasets-v2-page'

const queryMock = vi.hoisted(() => ({
  data: undefined as InfiniteData<KnowledgeSpaceList> | undefined,
  error: null as Error | null,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  refetch: vi.fn(),
}))

const mutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

const permissionStateMock = vi.hoisted(() => ({
  workspacePermissionKeys: ['dataset.create_and_management'],
  workspacePermissionKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useInfiniteQuery: () => queryMock,
    useMutation: () => mutationMock,
    useQueryClient: () => queryClientMock,
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

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@/context/permission-state', () => ({
  workspacePermissionKeysAtom: permissionStateMock.workspacePermissionKeysAtom,
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      listKnowledgeSpaces: {
        infiniteOptions: vi.fn(() => ({})),
        key: vi.fn(({ type }: { type?: 'infinite' | 'query' } = {}) => [
          'console',
          'knowledgeFs',
          'listKnowledgeSpaces',
          ...(type ? [type] : []),
        ]),
      },
      createKnowledgeSpace: {
        mutationOptions: vi.fn(() => ({})),
      },
    },
  },
}))

function setResolvedPage({
  items = [],
  hasMore = false,
}: {
  items?: NonNullable<typeof queryMock.data>['pages'][number]['items']
  hasMore?: boolean
} = {}) {
  queryMock.data = {
    pageParams: [null],
    pages: [
      {
        items,
        ...(hasMore ? { nextCursor: 'next-page' } : {}),
      },
    ],
  }
  queryMock.hasNextPage = hasMore
}

describe('DatasetsV2Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMock.data = undefined
    queryMock.error = null
    queryMock.hasNextPage = false
    queryMock.isFetchNextPageError = false
    queryMock.isFetchingNextPage = false
    queryMock.isPending = false
    mutationMock.isPending = false
    permissionStateMock.workspacePermissionKeys = ['dataset.create_and_management']
  })

  it('shows a scoped loading state while the first page is loading', () => {
    queryMock.isPending = true

    render(<DatasetsV2Page />)

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  })

  it('lets the user retry after the list request fails', async () => {
    const user = userEvent.setup()
    queryMock.error = new Error('request failed')

    render(<DatasetsV2Page />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(queryMock.refetch).toHaveBeenCalledOnce()
  })

  it('shows an empty state when Dataset 2.0 has no knowledge bases', () => {
    setResolvedPage()

    render(<DatasetsV2Page />)

    expect(screen.getByText('dataset.filterEmpty.noKnowledge')).toBeInTheDocument()
    expect(screen.getByText('dataset.newRag.emptyDescription')).toBeInTheDocument()
  })

  it('does not render a nested main landmark inside the common layout main landmark', () => {
    setResolvedPage()

    render(<DatasetsV2Page />)

    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })

  it('hides the create action from read-only users', () => {
    permissionStateMock.workspacePermissionKeys = []
    setResolvedPage()

    render(<DatasetsV2Page />)

    expect(
      screen.queryByRole('button', { name: 'common.operation.create' }),
    ).not.toBeInTheDocument()
  })

  it('renders knowledge-space cards and loads the next cursor page', async () => {
    const user = userEvent.setup()
    setResolvedPage({
      items: [
        {
          createdAt: '2026-07-15T00:00:00Z',
          description: 'Support materials',
          id: 'space-1',
          name: 'Support knowledge',
          revision: 1,
          slug: 'support-knowledge',
          tenantId: 'tenant-1',
          updatedAt: '2026-07-15T00:00:00Z',
        },
      ],
      hasMore: true,
    })

    render(<DatasetsV2Page />)

    const list = screen.getByRole('list', { name: 'dataset.knowledge' })
    expect(within(list).getByText('Support knowledge')).toBeInTheDocument()
    expect(within(list).getByText('support-knowledge')).toBeInTheDocument()
    expect(within(list).getByText('Support materials')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'dataset.newRag.loadMore' }))
    expect(queryMock.fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps loaded cards visible and retries locally when the next page fails', async () => {
    const user = userEvent.setup()
    setResolvedPage({
      items: [
        {
          createdAt: '2026-07-15T00:00:00Z',
          description: 'Support materials',
          id: 'space-1',
          name: 'Support knowledge',
          revision: 1,
          slug: 'support-knowledge',
          tenantId: 'tenant-1',
          updatedAt: '2026-07-15T00:00:00Z',
        },
      ],
      hasMore: true,
    })
    queryMock.error = new Error('next page failed')
    queryMock.isFetchNextPageError = true

    render(<DatasetsV2Page />)

    expect(screen.getByText('Support knowledge')).toBeInTheDocument()
    const paginationAlert = screen.getByRole('alert')
    expect(within(paginationAlert).getByText('dataset.unknownError')).toBeInTheDocument()

    await user.click(
      within(paginationAlert).getByRole('button', { name: 'common.operation.retry' }),
    )

    expect(queryMock.fetchNextPage).toHaveBeenCalledOnce()
    expect(queryMock.refetch).not.toHaveBeenCalled()
  })

  it('creates a non-Latin knowledge base with a server-generated slug and refreshes the list', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    render(<DatasetsV2Page />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'dataset.newRag.createDialogTitle',
    })
    const nameInput = within(dialog).getByRole('textbox', { name: 'datasetSettings.form.name' })

    expect(
      within(dialog).queryByRole('textbox', { name: 'dataset.newRag.slugLabel' }),
    ).not.toBeInTheDocument()
    await user.type(nameInput, '产品知识库')
    await user.type(
      within(dialog).getByRole('textbox', { name: /dataset\.externalKnowledgeDescription/ }),
      'Answers for customers',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
        body: {
          description: 'Answers for customers',
          idempotencyKey: expect.any(String),
          name: '产品知识库',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )

    const callbacks = mutationMock.mutate.mock.calls[0]?.[1]
    await act(async () => {
      callbacks.onSuccess()
    })

    expect(toastMock.success).toHaveBeenCalledWith('dataset.newRag.createSuccess')
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['console', 'knowledgeFs', 'listKnowledgeSpaces', 'infinite'],
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'dataset.newRag.createDialogTitle' }),
      ).not.toBeInTheDocument()
    })
  })

  it('keeps the create dialog open and reuses its idempotency key when creation is retried', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    render(<DatasetsV2Page />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'dataset.newRag.createDialogTitle',
    })
    const nameInput = within(dialog).getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.type(nameInput, 'Product Support')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    const callbacks = mutationMock.mutate.mock.calls[0]?.[1]
    await act(async () => {
      callbacks.onError()
    })

    expect(toastMock.error).toHaveBeenCalledWith('dataset.newRag.createFailed')
    expect(screen.getByRole('dialog', { name: 'dataset.newRag.createDialogTitle' })).toBeVisible()
    expect(nameInput).toHaveValue('Product Support')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutationMock.mutate).toHaveBeenCalledTimes(2)
    const firstKey = mutationMock.mutate.mock.calls[0]?.[0].body.idempotencyKey
    const retryKey = mutationMock.mutate.mock.calls[1]?.[0].body.idempotencyKey
    expect(firstKey).toEqual(expect.any(String))
    expect(retryKey).toBe(firstKey)
  })

  it('uses a new idempotency key when a failed creation is retried with edited content', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    render(<DatasetsV2Page />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'dataset.newRag.createDialogTitle',
    })
    const nameInput = within(dialog).getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.type(nameInput, 'Product Support')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    const callbacks = mutationMock.mutate.mock.calls[0]?.[1]
    await act(async () => {
      callbacks.onError()
    })

    await user.clear(nameInput)
    await user.type(nameInput, 'Customer Support')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutationMock.mutate).toHaveBeenCalledTimes(2)
    const firstKey = mutationMock.mutate.mock.calls[0]?.[0].body.idempotencyKey
    const editedKey = mutationMock.mutate.mock.calls[1]?.[0].body.idempotencyKey
    expect(editedKey).toEqual(expect.any(String))
    expect(editedKey).not.toBe(firstKey)
  })

  it('uses a new idempotency key after the create dialog is closed and reopened', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    render(<DatasetsV2Page />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const firstDialog = await screen.findByRole('dialog', {
      name: 'dataset.newRag.createDialogTitle',
    })
    await user.type(
      within(firstDialog).getByRole('textbox', { name: 'datasetSettings.form.name' }),
      'Product Support',
    )
    await user.click(within(firstDialog).getByRole('button', { name: 'common.operation.create' }))

    const callbacks = mutationMock.mutate.mock.calls[0]?.[1]
    await act(async () => {
      callbacks.onError()
    })
    await user.click(within(firstDialog).getByRole('button', { name: 'common.operation.cancel' }))

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const reopenedDialog = await screen.findByRole('dialog', {
      name: 'dataset.newRag.createDialogTitle',
    })
    await user.type(
      within(reopenedDialog).getByRole('textbox', { name: 'datasetSettings.form.name' }),
      'Product Support',
    )
    await user.click(
      within(reopenedDialog).getByRole('button', { name: 'common.operation.create' }),
    )

    expect(mutationMock.mutate).toHaveBeenCalledTimes(2)
    const firstKey = mutationMock.mutate.mock.calls[0]?.[0].body.idempotencyKey
    const reopenedKey = mutationMock.mutate.mock.calls[1]?.[0].body.idempotencyKey
    expect(reopenedKey).toEqual(expect.any(String))
    expect(reopenedKey).not.toBe(firstKey)
  })
})
