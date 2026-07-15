import type { KnowledgeSpaceListResponse } from '@dify/contracts/api/console/knowledge-spaces/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatasetsV2Page } from '../datasets-v2-page'

const queryMock = vi.hoisted(() => ({
  data: undefined as InfiniteData<KnowledgeSpaceListResponse> | undefined,
  error: null as Error | null,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
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
    knowledgeSpaces: {
      get: {
        infiniteOptions: vi.fn(() => ({})),
        key: vi.fn(({ type }: { type?: 'infinite' | 'query' } = {}) => [
          'console',
          'knowledgeSpaces',
          'get',
          ...(type ? [type] : []),
        ]),
      },
      post: {
        mutationOptions: vi.fn(() => ({})),
      },
    },
  },
}))

function setResolvedPage({
  data = [],
  enabled = true,
  hasMore = false,
}: {
  data?: NonNullable<typeof queryMock.data>['pages'][number]['data']
  enabled?: boolean
  hasMore?: boolean
} = {}) {
  queryMock.data = {
    pageParams: [null],
    pages: [
      {
        data,
        enabled,
        has_more: hasMore,
        next_cursor: hasMore ? 'next-page' : null,
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

  it('explains that Dataset 2.0 is unavailable when KnowledgeFS is disabled', () => {
    setResolvedPage({ enabled: false })

    render(<DatasetsV2Page />)

    expect(screen.getByText('dataset.unavailable')).toBeInTheDocument()
    expect(screen.getByText('dataset.newRag.disabledDescription')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.create' }),
    ).not.toBeInTheDocument()
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
      data: [
        {
          created_at: '2026-07-15T00:00:00Z',
          description: 'Support materials',
          id: 'space-1',
          name: 'Support knowledge',
          slug: 'support-knowledge',
          updated_at: '2026-07-15T00:00:00Z',
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

  it('creates an empty knowledge base with an editable generated slug and refreshes the list', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    render(<DatasetsV2Page />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'dataset.newRag.createDialogTitle',
    })
    const nameInput = within(dialog).getByRole('textbox', { name: 'datasetSettings.form.name' })
    const slugInput = within(dialog).getByRole('textbox', { name: 'dataset.newRag.slugLabel' })

    expect(slugInput).toHaveAttribute('maxlength', '160')
    await user.type(nameInput, 'Product Support')
    expect(slugInput).toHaveValue('product-support')
    await user.clear(slugInput)
    await user.type(slugInput, 'product-help')
    await user.type(
      within(dialog).getByRole('textbox', { name: /dataset\.externalKnowledgeDescription/ }),
      'Answers for customers',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(mutationMock.mutate).toHaveBeenCalledWith(
      {
        body: {
          description: 'Answers for customers',
          name: 'Product Support',
          slug: 'product-help',
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
      queryKey: ['console', 'knowledgeSpaces', 'get', 'infinite'],
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'dataset.newRag.createDialogTitle' }),
      ).not.toBeInTheDocument()
    })
  })

  it('keeps the create dialog open and notifies the user when creation fails', async () => {
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
  })

  it('keeps the create dialog open when the edited slug is invalid', async () => {
    const user = userEvent.setup()
    setResolvedPage()
    render(<DatasetsV2Page />)

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'dataset.newRag.createDialogTitle',
    })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'datasetSettings.form.name' }),
      'Product Support',
    )
    const slugInput = within(dialog).getByRole('textbox', { name: 'dataset.newRag.slugLabel' })
    await user.clear(slugInput)
    await user.type(slugInput, 'Invalid Slug')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.create' }))

    expect(await within(dialog).findByText('dataset.newRag.slugInvalid')).toBeInTheDocument()
    expect(mutationMock.mutate).not.toHaveBeenCalled()
  })
})
