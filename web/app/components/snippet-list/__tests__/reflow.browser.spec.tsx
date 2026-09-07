import type { SnippetListItem } from '@/types/snippet'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import SnippetList from '..'

const mockUseInfiniteSnippetList = vi.hoisted(() => vi.fn())
const mockQueryState = vi.hoisted(() => ({
  creatorIDs: [] as string[],
  keywords: '',
  tagIDs: [] as string[],
}))

vi.mock('@/service/use-snippets', () => ({
  useConfirmSnippetImportMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateSnippetMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteSnippetMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useExportSnippetMutation: () => ({ mutateAsync: vi.fn() }),
  useImportSnippetDSLMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useInfiniteSnippetList: (params: unknown, options: unknown) =>
    mockUseInfiniteSnippetList(params, options),
  useUpdateSnippetMutation: () => ({ isPending: false, mutate: vi.fn() }),
}))

vi.mock('../hooks/use-snippets-query-state', () => ({
  useSnippetsQueryState: () => ({
    query: mockQueryState,
    setCreatorIDs: vi.fn(),
    setKeywords: vi.fn(),
    setTagIDs: vi.fn(),
  }),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
  }))
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['snippets.create_and_modify'],
  }))
})

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        {
          avatar_url: null,
          id: 'creator-1',
          name: 'Alice',
          status: 'active',
        },
      ],
    },
  }),
}))

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryFn: async () => ({ profile: { id: 'creator-1' } }),
    queryKey: ['account-profile'],
  }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    snippets: {
      bySnippetId: {
        workflows: {
          draft: {
            post: vi.fn(),
          },
        },
      },
    },
  },
  consoleQuery: {
    tags: {
      get: {
        key: () => ['tags'],
        queryOptions: ({ input }: { input: { query: { type: string } } }) => ({
          queryFn: async () => [],
          queryKey: ['tags', input.query.type],
        }),
      },
      post: {
        mutationOptions: () => ({ mutationFn: vi.fn() }),
      },
    },
  },
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const snippet: SnippetListItem = {
  created_at: 1704067200,
  created_by: 'creator-1',
  description: 'Builds a sales follow-up.',
  id: 'snippet-1',
  is_published: true,
  name: 'Sales Snippet',
  tags: [],
  type: 'node',
  updated_at: 1704153600,
  updated_by: 'creator-1',
  use_count: 12,
  version: 1,
}

const expectWithinHorizontalBounds = (element: Element, container: Element) => {
  const elementRect = element.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  expect(elementRect.left).toBeGreaterThanOrEqual(containerRect.left - 0.5)
  expect(elementRect.right).toBeLessThanOrEqual(containerRect.right + 0.5)
}

const renderSnippetList = async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  queryClient.setQueryData(['account-profile'], { profile: { id: 'creator-1' } })
  queryClient.setQueryData(['tags', 'snippet'], [])

  const store = createStore()
  seedRegisteredConsoleStateFixture(store)

  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <main
          aria-label="Snippet list page"
          className="flex h-dvh w-full min-w-0 flex-col overflow-hidden"
          style={{ width: 320 }}
        >
          <SnippetList />
        </main>
      </Provider>
    </QueryClientProvider>,
  )
}

describe('Snippet list reflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInfiniteSnippetList.mockReturnValue({
      data: {
        pages: [
          {
            data: [snippet],
            has_more: false,
            limit: 30,
            page: 1,
            total: 1,
          },
        ],
      },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      refetch: vi.fn(),
    })
  })

  afterEach(async () => {
    await page.viewport(1280, 720)
  })

  it('keeps the real filters, search, create action, and card overflow-free with 320 CSS pixels available', async () => {
    // This isolates SnippetList's 320px component contract; the route shell owns page-level width.
    await page.viewport(400, 800)
    const screen = await renderSnippetList()
    const main = screen.getByRole('main', { name: 'Snippet list page' })
    const creatorFilter = screen.getByRole('combobox', {
      name: 'app.studio.filters.creators',
    })
    const statusFilter = screen.getByRole('button', {
      name: /workflow\.common\.published \/ snippet\.draft/i,
    })
    const tagFilter = screen.getByRole('combobox', { name: 'common.tag.placeholder' })
    const search = screen.getByRole('searchbox', { name: 'workflow.tabs.searchSnippets' })
    const createAction = screen.getByRole('button', { name: 'snippet.create' })
    const card = screen.getByRole('article')

    await expect
      .element(screen.getByRole('heading', { name: 'workflow.tabs.snippets' }))
      .toBeVisible()
    await expect.element(creatorFilter).toBeVisible()
    await expect.element(statusFilter).toBeVisible()
    await expect.element(tagFilter).toBeVisible()
    await expect.element(search).toBeVisible()
    await expect.element(createAction).toBeVisible()
    await expect.element(card).toBeVisible()

    const mainElement = main.element()
    const gridElement = card.element().closest('[aria-busy]')
    if (!gridElement) throw new Error('Snippet card did not render inside the list grid')

    expect(mainElement.clientWidth).toBe(320)
    expect(mainElement.scrollWidth).toBe(mainElement.clientWidth)
    expect(gridElement.scrollWidth).toBe(gridElement.clientWidth)
    ;[creatorFilter, statusFilter, tagFilter, search, createAction, card].forEach((locator) => {
      expectWithinHorizontalBounds(locator.element(), mainElement)
    })
  })
})
