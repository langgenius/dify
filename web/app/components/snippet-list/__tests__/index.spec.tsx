import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWithNuqs } from '@/test/nuqs-testing'
import SnippetList from '..'

const mockUseInfiniteSnippetList = vi.hoisted(() => vi.fn())
vi.mock('@/service/use-snippets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-snippets')>()),
  useInfiniteSnippetList: (params: unknown, options: unknown) =>
    mockUseInfiniteSnippetList(params, options),
}))

const mockBindTags = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'tagBindings.post': mockBindTags,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': async () => ({
        accounts: [
          { id: 'creator-1', name: 'Alice', avatar_url: null, status: 'active' },
          { id: 'creator-2', name: 'Bob', avatar_url: null, status: 'active' },
        ],
      }),
      'tags.get': async () => [
        { id: 'tag-1', name: 'Sales', type: 'snippet', binding_count: '0' },
        { id: 'tag-2', name: 'Support', type: 'snippet', binding_count: '0' },
      ],
    }),
  }
})

const mockWorkspacePermissionKeys = vi.fn(() => ['snippets.create_and_modify'])

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    userProfile: { id: 'creator-1' },
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: { id: 'creator-1' },
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockDynamicComponent(props: {
      show: boolean
      onClose: () => void
      onTagsChange: () => void
    }) {
      return React.createElement(
        'div',
        {
          'data-testid': 'tag-management-modal',
          'data-show': String(props.show),
        },
        React.createElement(
          'button',
          { type: 'button', onClick: props.onClose },
          'close tag modal',
        ),
        React.createElement(
          'button',
          { type: 'button', onClick: props.onTagsChange },
          'refresh tags',
        ),
      )
    }
  },
}))

let intersectionCallback: IntersectionObserverCallback | undefined
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

beforeEach(() => {
  intersectionCallback = undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        if (options?.root) intersectionCallback = callback
      }

      observe = mockObserve
      disconnect = mockDisconnect
      unobserve = vi.fn()
      root = null
      rootMargin = ''
      thresholds = []
      takeRecords = () => []
    } as unknown as typeof IntersectionObserver,
  )
})
afterEach(() => vi.unstubAllGlobals())

const mockRefetch = vi.fn()
const mockFetchNextPage = vi.fn()

const mockSnippetListState = {
  data: {
    pages: [
      {
        data: [
          {
            id: 'snippet-1',
            name: 'Sales Snippet',
            description: 'Builds a sales follow-up.',
            type: 'node',
            is_published: true,
            use_count: 12,
            tags: [],
            created_at: 1704067200,
            created_by: 'creator-1',
            updated_at: 1704153600,
            updated_by: 'creator-2',
          },
        ],
        page: 1,
        limit: 30,
        total: 1,
        has_more: false,
      },
    ],
  },
  isLoading: false,
  isFetching: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  error: null as Error | null,
}

const renderList = ({
  searchParams = '',
}: {
  searchParams?: string
} = {}) => {
  const { wrapper: ConsoleQueryWrapper } = createConsoleQueryWrapper({
    accountProfile: { id: 'creator-1' },
  })
  const createList = () => (
    <ConsoleQueryWrapper>
      <SnippetList />
    </ConsoleQueryWrapper>
  )
  const rendered = renderWithNuqs(createList(), { searchParams, hasMemory: true })

  return {
    ...rendered,
    rerenderList: () => rendered.rerender(createList()),
  }
}

describe('SnippetList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBindTags.mockResolvedValue({ result: 'success' })
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
    intersectionCallback = undefined
  })

  it('renders the dedicated snippets list layout', () => {
    renderList()

    expect(screen.getByRole('link', { name: 'navigation.menus.apps' })).toHaveAttribute(
      'href',
      '/apps',
    )
    expect(screen.getByRole('heading', { name: 'workflow.tabs.snippets' })).toBeInTheDocument()
    const path = within(screen.getByRole('navigation', { name: 'workflow.tabs.snippets' }))
    expect(path.getByRole('link', { name: 'navigation.menus.apps' })).toHaveAttribute(
      'href',
      '/apps',
    )
    expect(path.getByText('workflow.tabs.snippets')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('app.studio.filters.creators')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('common.tag.placeholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('workflow.tabs.searchSnippets')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'snippet.create' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sales Snippet/ })).toHaveAttribute(
      'href',
      '/snippets/snippet-1/orchestrate',
    )
    expect(screen.getByTestId('tag-management-modal')).toBeInTheDocument()
  })

  it('combines URL search and tags with the selected creator when requesting snippets', async () => {
    const user = userEvent.setup()
    renderList({ searchParams: '?tagIDs=tag-1;tag-2&keywords=sales' })
    await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
    await user.click(await screen.findByRole('option', { name: /Bob/ }))
    await waitFor(() =>
      expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith(
        {
          page: 1,
          limit: 30,
          keyword: 'sales',
          tag_ids: ['tag-1', 'tag-2'],
          creator_ids: ['creator-2'],
        },
        { enabled: true },
      ),
    )
  })

  it.each([
    { label: 'workflow.common.published', published: true },
    { label: 'snippet.draft', published: false },
  ])('filters $label and returns to all statuses', async ({ label, published }) => {
    const user = userEvent.setup()
    renderList()
    await user.click(
      screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i }),
    )
    await user.click(await screen.findByRole('menuitemradio', { name: label }))
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith(
      expect.objectContaining({ is_published: published }),
      { enabled: true },
    )
    await user.click(screen.getByRole('button', { name: label }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'app.types.all' }))
    expect(
      screen.getByRole('button', { name: /workflow\.common\.published \/ snippet\.draft/i }),
    ).toBeInTheDocument()
    expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ is_published: expect.any(Boolean) }),
      { enabled: true },
    )
  })

  it('searches and clears the filter through actual query state', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderList()
    const search = screen.getByRole('searchbox', { name: 'workflow.tabs.searchSnippets' })
    await user.type(search, 'summary')
    expect(search).toHaveValue('summary')
    await waitFor(() =>
      expect(mockUseInfiniteSnippetList.mock.lastCall?.[0].keyword).toBe('summary'),
    )
    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('keywords')).toBe('summary'),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(search).toHaveValue('')
    await waitFor(() =>
      expect(mockUseInfiniteSnippetList).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: '' }),
        { enabled: true },
      ),
    )
    await waitFor(() =>
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('keywords')).toBe(false),
    )
  })

  it('fetches snippets without create action for users with snippet management permission', () => {
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.management'])

    renderList()

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith(expect.any(Object), {
      enabled: true,
    })
    expect(screen.getByRole('link', { name: /Sales Snippet/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
  })

  it('does not fetch or render snippets without snippet list permissions', () => {
    mockWorkspacePermissionKeys.mockReturnValue([])

    const { container } = renderList()
    const list = container.querySelector<HTMLElement>('[aria-busy]')
    if (!list) throw new Error('Snippet list did not render its result owner')

    expect(mockUseInfiniteSnippetList).toHaveBeenCalledWith(expect.any(Object), {
      enabled: false,
    })
    expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
    expect(within(list).getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
  })

  it('shows an empty state when no snippets are returned', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: {
        pages: [
          {
            data: [],
            page: 1,
            limit: 30,
            total: 0,
            has_more: false,
          },
        ],
      },
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    const { container } = renderList()
    const list = container.querySelector<HTMLElement>('[aria-busy]')
    if (!list) throw new Error('Snippet list did not render its result owner')

    expect(within(list).getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('workflow.tabs.noSnippetsFound')
  })

  it('announces request failures and preserves retry focus while refetching', async () => {
    const user = userEvent.setup()
    const requestError = new Error('Request failed')
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: { pages: [] },
      error: requestError,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    const { rerenderList } = renderList()
    const status = screen.getByRole('status')
    const retryButton = screen.getByRole('button', { name: 'common.operation.retry' })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(status).toHaveTextContent('common.errorBoundary.title')
    expect(status).not.toHaveTextContent('workflow.tabs.noSnippetsFound')

    await user.click(retryButton)

    expect(mockRefetch).toHaveBeenCalledTimes(1)
    expect(retryButton).toHaveFocus()

    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: { pages: [] },
      error: requestError,
      isFetching: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
    rerenderList()

    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBe(retryButton)
    expect(retryButton).toHaveFocus()
    expect(status).toHaveTextContent('common.loading')

    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: { pages: [] },
      error: requestError,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
    rerenderList()

    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBe(retryButton)
    expect(retryButton).toHaveFocus()
    expect(status).toHaveTextContent('common.errorBoundary.title')
  })

  it('announces the total result count when only the first page is loaded', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: {
        pages: [
          {
            ...mockSnippetListState.data.pages[0]!,
            total: 80,
            has_more: true,
          },
        ],
      },
      hasNextPage: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    renderList()

    expect(screen.getByRole('status')).toHaveTextContent(
      'common.operation.searchCount:{"count":80,"content":"workflow.tabs.snippets"}',
    )
  })

  it('announces kept-data refreshes when the result count stays the same', () => {
    const { rerenderList } = renderList()
    const status = screen.getByRole('status')
    const grid = screen.getByRole('link', { name: /Sales Snippet/ }).closest('[aria-busy]')

    expect(status.closest('[aria-busy]')).toBeNull()
    expect(status).toHaveTextContent(
      'common.operation.searchCount:{"count":1,"content":"workflow.tabs.snippets"}',
    )

    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      isFetching: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
    rerenderList()

    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('common.loading')
    expect(grid).toHaveAttribute('aria-busy', 'true')

    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: {
        pages: [
          {
            ...mockSnippetListState.data.pages[0]!,
            data: [
              {
                ...mockSnippetListState.data.pages[0]!.data[0]!,
                id: 'snippet-2',
                name: 'Support Snippet',
              },
            ],
          },
        ],
      },
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
    rerenderList()

    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent(
      'common.operation.searchCount:{"count":1,"content":"workflow.tabs.snippets"}',
    )
    expect(screen.getByRole('link', { name: /Support Snippet/ })).toBeInTheDocument()
    expect(grid).toHaveAttribute('aria-busy', 'false')
  })

  it('mounts an empty live region before announcing initial results', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      data: { pages: [] },
      isFetching: true,
      isLoading: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    const { container, rerenderList } = renderList()
    const status = screen.getByRole('status')

    expect(status).toBeEmptyDOMElement()
    expect(status.closest('[aria-busy]')).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()

    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })
    rerenderList()

    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent(
      'common.operation.searchCount:{"count":1,"content":"workflow.tabs.snippets"}',
    )
  })

  it('keeps current results available while the next page is loading', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      isFetchingNextPage: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    renderList()
    const card = screen.getByRole('link', { name: /Sales Snippet/ })
    const list = card.closest('[aria-busy]')

    expect(card).toBeInTheDocument()
    expect(list).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
  })

  it('fetches the next page when the scroll anchor intersects', () => {
    mockUseInfiniteSnippetList.mockReturnValue({
      ...mockSnippetListState,
      hasNextPage: true,
      refetch: mockRefetch,
      fetchNextPage: mockFetchNextPage,
    })

    renderList()

    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )

    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('does not register infinite scroll without snippet list permissions', () => {
    mockWorkspacePermissionKeys.mockReturnValue([])

    renderList()

    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('opens tag management from real filters and cards and refreshes after a binding change', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.mockReturnValue([
      'snippets.create_and_modify',
      'snippets.management',
    ])
    renderList()
    await user.click(screen.getByRole('combobox', { name: 'common.tag.placeholder' }))
    await user.click(await screen.findByRole('button', { name: 'common.tag.manageTags' }))
    expect(screen.getByTestId('tag-management-modal')).toHaveAttribute('data-show', 'true')
    await user.click(screen.getByRole('button', { name: 'close tag modal' }))
    expect(screen.getByTestId('tag-management-modal')).toHaveAttribute('data-show', 'false')
    await user.click(screen.getByRole('combobox', { name: 'common.tag.addTag: Sales Snippet' }))
    await user.click(await screen.findByRole('option', { name: 'Sales' }))
    await user.click(screen.getByRole('button', { name: 'common.tag.manageTags' }))
    expect(screen.getByTestId('tag-management-modal')).toHaveAttribute('data-show', 'true')
    await waitFor(() =>
      expect(mockBindTags).toHaveBeenCalledExactlyOnceWith({
        body: { tag_ids: ['tag-1'], target_id: 'snippet-1', type: 'snippet' },
      }),
    )
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: 'refresh tags' }))
    expect(mockRefetch).toHaveBeenCalledTimes(2)
  })
})
