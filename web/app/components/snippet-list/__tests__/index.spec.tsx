import type { SnippetListItemResponse as Snippet } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { consoleClient } from '@/service/console'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { SnippetDetailTop } from '@/app/components/snippets/components/snippet-detail-top'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import SnippetList from '..'

type SnippetListResponse = Awaited<
  ReturnType<typeof consoleClient.workspaces.current.customizedSnippets.get>
>

const listSnippets = vi.hoisted(() =>
  vi.fn<typeof consoleClient.workspaces.current.customizedSnippets.get>(),
)
const mockBindTags = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'tagBindings.post': mockBindTags,
      'workspaces.current.customizedSnippets.get': listSnippets,
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

let workspacePermissionKeys = ['snippets.create_and_modify']
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
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

const snippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: 'snippet-1',
  name: 'Sales Snippet',
  description: 'Builds a sales follow-up.',
  type: 'node',
  is_published: true,
  use_count: 12,
  tags: [],
  author_name: null,
  icon_info: null,
  version: 1,
  created_at: 1704067200,
  created_by: 'creator-1',
  updated_at: 1704153600,
  updated_by: 'creator-2',
  ...overrides,
})
const page = (
  data = [snippet()],
  overrides: Partial<SnippetListResponse> = {},
): SnippetListResponse => ({
  data,
  page: 1,
  limit: 30,
  total: data.length,
  has_more: false,
  ...overrides,
})
const fullPage = () =>
  page(
    Array.from({ length: 30 }, (_, index) =>
      snippet({
        id: `snippet-${index + 1}`,
        name: index ? `Snippet ${index + 1}` : 'Sales Snippet',
      }),
    ),
    { total: 31, has_more: true },
  )

const renderList = ({
  searchParams = '',
}: {
  searchParams?: string
} = {}) => {
  const { wrapper: ConsoleQueryWrapper, queryClient } = createConsoleQueryWrapper({
    accountProfile: { id: 'creator-1' },
    workspacePermissionKeys,
  })
  const onUrlUpdate = vi.fn()
  const createRoute = (path: string, params: string, content: ReactNode) => (
    <ConsoleQueryWrapper>
      <NuqsTestingAdapter
        rateLimitFactor={0}
        key={path}
        searchParams={params}
        hasMemory
        onUrlUpdate={onUrlUpdate}
      >
        {content}
      </NuqsTestingAdapter>
    </ConsoleQueryWrapper>
  )
  const createList = () => createRoute('/snippets', searchParams, <SnippetList />)
  const rendered = render(createList())

  return {
    ...rendered,
    queryClient,
    onUrlUpdate,
    rerenderList: () => rendered.rerender(createList()),
    showDetail: () =>
      rendered.rerender(createRoute('/snippets/snippet-1/orchestrate', '', <SnippetDetailTop />)),
    showList: (href: string) =>
      rendered.rerender(createRoute('/snippets', href.split('?')[1] ?? '', <SnippetList />)),
  }
}

beforeEach(() => {
  listSnippets.mockReset().mockResolvedValue(page())
  mockBindTags.mockReset().mockResolvedValue({ result: 'success' })
  workspacePermissionKeys = ['snippets.create_and_modify']
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const salesCard = () => screen.findByRole('link', { name: /Sales Snippet/ })
const searchParams = (query: Record<string, unknown>) => ({
  query: { page: 1, limit: 30, ...query },
})

it('renders the snippet layout and links after the request resolves', async () => {
  renderList()
  expect(await salesCard()).toHaveAttribute('href', '/snippets/snippet-1/orchestrate')
  expect(screen.getByRole('heading', { name: 'workflow.tabs.snippets' })).toBeInTheDocument()
  const path = within(screen.getByRole('navigation', { name: 'workflow.tabs.snippets' }))
  expect(path.getByRole('link', { name: 'navigation.menus.apps' })).toHaveAttribute('href', '/apps')
  expect(path.getByText('workflow.tabs.snippets')).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'snippet.create' })).toBeInTheDocument()
})

it('combines URL search and tags with the selected creator in the service request', async () => {
  const user = userEvent.setup()
  renderList({ searchParams: '?tagIDs=tag-1;tag-2&keywords=sales' })
  await salesCard()
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
  await user.click(await screen.findByRole('option', { name: /Bob/ }))
  await waitFor(() =>
    expect(listSnippets).toHaveBeenLastCalledWith(
      searchParams({ keyword: 'sales', tag_ids: ['tag-1', 'tag-2'], creators: ['creator-2'] }),
    ),
  )
})

it('retains creator, tag and publication selections through the snippet return link', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate, showDetail, showList } = renderList()
  await salesCard()
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
  await user.click(await screen.findByRole('option', { name: /Alice/ }))
  await user.click(screen.getByRole('option', { name: /Bob/ }))
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('combobox', { name: 'common.tag.placeholder' }))
  await user.click(await screen.findByRole('option', { name: 'Sales' }))
  await user.keyboard('{Escape}')
  await user.click(
    screen.getByRole('button', { name: 'workflow.common.published / snippet.draft' }),
  )
  await user.click(await screen.findByRole('menuitemradio', { name: 'snippet.draft' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('publishStatus')).toBe('draft'),
  )
  showDetail()
  const href = screen.getByRole('link', { name: 'workflow.tabs.snippets' }).getAttribute('href')!
  const params = new URLSearchParams(href.split('?')[1])
  expect(params.get('creatorIDs')).toBe('creator-1;creator-2')
  expect(params.get('tagIDs')).toBe('tag-1')
  expect(params.get('publishStatus')).toBe('draft')
  showList(href)
  await salesCard()
  expect(screen.getByRole('button', { name: 'snippet.draft' })).toBeInTheDocument()
  expect(await screen.findByRole('combobox', { name: 'Sales' })).toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
  expect(await screen.findByRole('option', { name: /Alice/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(screen.getByRole('option', { name: /Bob/ })).toHaveAttribute('aria-selected', 'true')
  expect(listSnippets).toHaveBeenLastCalledWith(
    searchParams({ creators: ['creator-1', 'creator-2'], tag_ids: ['tag-1'], is_published: false }),
  )
})

it('does not restore cleared creators, tags or publication status', async () => {
  const user = userEvent.setup()
  const { onUrlUpdate, showDetail, showList } = renderList({
    searchParams: '?creatorIDs=creator-1&tagIDs=tag-1&publishStatus=published',
  })
  await salesCard()
  await user.click(screen.getByRole('button', { name: 'app.studio.filters.reset' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  await user.click(screen.getByRole('button', { name: 'workflow.common.published' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'app.types.all' }))
  await waitFor(() => expect(onUrlUpdate.mock.lastCall?.[0].searchParams.toString()).toBe(''))
  showDetail()
  expect(screen.getByRole('link', { name: 'workflow.tabs.snippets' })).toHaveAttribute(
    'href',
    '/snippets',
  )
  showList('/snippets')
  await salesCard()
  expect(screen.queryByRole('button', { name: 'app.studio.filters.reset' })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'common.tag.placeholder' })).toBeInTheDocument()
  expect(listSnippets).toHaveBeenLastCalledWith(searchParams({}))
})

it.each([
  { label: 'workflow.common.published', published: true },
  { label: 'snippet.draft', published: false },
])('filters $label and returns to all statuses', async ({ label, published }) => {
  const user = userEvent.setup()
  listSnippets.mockImplementation(
    async ({ query }: NonNullable<Parameters<typeof listSnippets>[0]> = {}) =>
      page([
        snippet({
          name: typeof query?.is_published === 'boolean' ? 'Filtered snippet' : 'Sales Snippet',
        }),
      ]),
  )
  renderList()
  await salesCard()
  await user.click(
    screen.getByRole('button', { name: 'workflow.common.published / snippet.draft' }),
  )
  await user.click(await screen.findByRole('menuitemradio', { name: label }))
  expect(await screen.findByRole('link', { name: /Filtered snippet/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
  expect(listSnippets).toHaveBeenLastCalledWith(searchParams({ is_published: published }))
  await user.click(screen.getByRole('button', { name: label }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'app.types.all' }))
  expect(await salesCard()).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Filtered snippet/ })).not.toBeInTheDocument()
})

it('searches and clears the filter through actual query state', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  listSnippets.mockImplementation(
    async ({ query }: NonNullable<Parameters<typeof listSnippets>[0]> = {}) =>
      page([snippet({ name: query?.keyword ? 'Summary snippet' : 'Sales Snippet' })]),
  )
  const { onUrlUpdate } = renderList()
  await salesCard()
  const search = screen.getByRole('searchbox', { name: 'workflow.tabs.searchSnippets' })
  await user.type(search, 'summary')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(await screen.findByRole('link', { name: /Summary snippet/ })).toBeInTheDocument()
  expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('keywords')).toBe('summary')
  expect(listSnippets).toHaveBeenLastCalledWith(searchParams({ keyword: 'summary' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(await salesCard()).toBeInTheDocument()
  expect(search).toHaveValue('')
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('keywords')).toBe(false),
  )
})

it('fetches snippets without create action for users with management permission', async () => {
  workspacePermissionKeys = ['snippets.management']
  renderList()
  expect(await salesCard()).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
})

it('does not fetch or register infinite scroll without list permissions', () => {
  workspacePermissionKeys = []
  renderList()
  expect(listSnippets).not.toHaveBeenCalled()
  expect(intersectionCallback).toBeUndefined()
  expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'snippet.create' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('workflow.tabs.noSnippetsFound')
})

it('announces an empty result after the request resolves', async () => {
  listSnippets.mockResolvedValue(page([]))
  renderList()
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('workflow.tabs.noSnippetsFound'),
  )
  expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
})

it('announces request and retry failures through the real query lifecycle', async () => {
  const user = userEvent.setup()
  const retry = createDeferred<SnippetListResponse>()
  listSnippets.mockRejectedValueOnce(new Error('Request failed')).mockReturnValueOnce(retry.promise)
  renderList()
  const retryButton = await screen.findByRole('button', { name: 'common.operation.retry' })
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('common.errorBoundary.title')
  await user.click(retryButton)
  await waitFor(() => expect(listSnippets).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
  await act(async () => retry.reject(new Error('Retry failed')))
  await waitFor(() => expect(status).toHaveTextContent('common.errorBoundary.title'))
  expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeEnabled()
})

it('keeps the first page while loading the next and appends the new results on intersection', async () => {
  const next = createDeferred<SnippetListResponse>()
  listSnippets.mockResolvedValueOnce(fullPage()).mockReturnValueOnce(next.promise)
  renderList()
  await salesCard()
  expect(screen.getByRole('status')).toHaveTextContent(
    'common.operation.searchCount:{"count":31,"content":"workflow.tabs.snippets"}',
  )
  expect(intersectionCallback).toBeDefined()
  act(() =>
    intersectionCallback!(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  )
  await waitFor(() =>
    expect(listSnippets).toHaveBeenLastCalledWith({ query: { page: 2, limit: 30 } }),
  )
  expect(screen.getByRole('link', { name: /Sales Snippet/ })).toBeInTheDocument()
  await act(async () =>
    next.resolve(
      page([snippet({ id: 'snippet-31', name: 'Final snippet' })], { page: 2, total: 31 }),
    ),
  )
  expect(await screen.findByRole('link', { name: /Final snippet/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Sales Snippet/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Snippet 30/ })).toBeInTheDocument()
})

it('announces kept-data refreshes when the result count stays the same', async () => {
  const refresh = createDeferred<SnippetListResponse>()
  listSnippets.mockResolvedValueOnce(page()).mockReturnValueOnce(refresh.promise)
  const { queryClient } = renderList()
  await salesCard()
  const status = screen.getByRole('status')
  act(() => {
    void queryClient.invalidateQueries({ queryKey: ['snippets', 'list'] })
  })
  await waitFor(() => expect(status).toHaveTextContent('common.loading'))
  expect(screen.getByRole('link', { name: /Sales Snippet/ })).toBeInTheDocument()
  await act(async () => refresh.resolve(page([snippet({ name: 'Support Snippet' })])))
  expect(await screen.findByRole('link', { name: /Support Snippet/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
  expect(status).toHaveTextContent(
    'common.operation.searchCount:{"count":1,"content":"workflow.tabs.snippets"}',
  )
})

it('mounts an empty live region before announcing initial results', async () => {
  const initial = createDeferred<SnippetListResponse>()
  listSnippets.mockReturnValue(initial.promise)
  renderList()
  const status = screen.getByRole('status')
  expect(status).toBeEmptyDOMElement()
  expect(screen.queryByRole('link', { name: /Sales Snippet/ })).not.toBeInTheDocument()
  await act(async () => initial.resolve(page()))
  expect(await salesCard()).toBeInTheDocument()
  expect(status).toHaveTextContent(
    'common.operation.searchCount:{"count":1,"content":"workflow.tabs.snippets"}',
  )
})

it('opens real tag management from filters and cards and refreshes after a binding change', async () => {
  const user = userEvent.setup()
  workspacePermissionKeys = ['snippets.create_and_modify', 'snippets.management']
  let tagged = false
  mockBindTags.mockImplementation(async () => {
    tagged = true
    return { result: 'success' }
  })
  listSnippets.mockImplementation(async () =>
    page([
      snippet({
        name: tagged ? 'Tagged snippet' : 'Sales Snippet',
        tags: tagged ? [{ id: 'tag-1', name: 'Sales', type: 'snippet' }] : [],
      }),
    ]),
  )
  renderList()
  await salesCard()
  await user.click(screen.getByRole('combobox', { name: 'common.tag.placeholder' }))
  await user.click(await screen.findByRole('button', { name: 'common.tag.manageTags' }))
  const dialog = await screen.findByRole('dialog', { name: 'common.tag.manageTags' })
  expect(within(dialog).getByRole('textbox', { name: 'common.tag.addNew' })).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('combobox', { name: 'common.tag.addTag: Sales Snippet' }))
  await user.click(await screen.findByRole('option', { name: 'Sales' }))
  await user.keyboard('{Escape}')
  expect(await screen.findByRole('combobox', { name: 'Sales: Tagged snippet' })).toBeInTheDocument()
  expect(mockBindTags).toHaveBeenCalledExactlyOnceWith({
    body: { tag_ids: ['tag-1'], target_id: 'snippet-1', type: 'snippet' },
  })
  await user.click(screen.getByRole('combobox', { name: 'Sales: Tagged snippet' }))
  expect(await screen.findByRole('option', { name: 'Sales' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await user.click(screen.getByRole('button', { name: 'common.tag.manageTags' }))
  expect(await screen.findByRole('dialog', { name: 'common.tag.manageTags' })).toBeInTheDocument()
})
