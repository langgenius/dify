import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { ReactNode } from 'react'
import type { StepByStepTourSessionState } from '@/app/components/step-by-step-tour/types'
import type { consoleClient } from '@/service/console'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { zAppPagination } from '@dify/contracts/api/console/apps/zod.gen'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { AppDetailTop } from '@/app/components/app-sidebar/app-detail-top'
import { stepByStepTourSessionAtom } from '@/app/components/step-by-step-tour/state'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { mockIntersectionObserver } from '@/test/intersection-observer'
import { AppACLPermission } from '@/utils/permission'
import { List } from '../list'

const api = vi.hoisted(() => ({
  apps: vi.fn<typeof consoleClient.apps.get>(),
  delete: vi.fn<typeof consoleClient.apps.byAppId.delete>(),
  starred: vi.fn<typeof consoleClient.apps.starred.get>(),
  online: vi.fn<typeof consoleClient.apps.workflows.onlineUsers.post>(),
  learn: vi.fn<typeof consoleClient.explore.apps.learnDify.get>(),
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push, replace: api.replace }),
  usePathname: () => '/apps',
  useSearchParams: () => api.searchParams,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': api.apps,
      'apps.byAppId.delete': api.delete,
      'apps.starred.get': api.starred,
      'apps.workflows.onlineUsers.post': api.online,
      'explore.apps.learnDify.get': api.learn,
      'explore.apps.get': async () => ({ recommended_apps: [], categories: [] }),
      'tags.get': async () => [{ id: 'tag-1', name: 'Research', type: 'app' }],
    }),
  }
})

const app = (overrides: Partial<AppPartial> = {}) => ({
  ...createAppDetailFixture({ id: 'app-1', name: 'Chat app', maintainer: 'creator-1' }),
  permission_keys: [AppACLPermission.Edit],
  ...overrides,
})
const apps = [app(), app({ id: 'app-2', name: 'Workflow app', mode: 'workflow' })]
const page = (data = apps, pageNumber = 1, hasMore = false) =>
  zAppPagination.parse({
    data,
    page: pageNumber,
    limit: 30,
    has_more: hasMore,
    total: data.length,
  })
const search = () =>
  screen.getByRole('searchbox', { name: 'app.gotoAnything.actions.searchApplications' })
const catalog = () => screen.getByRole('region', { name: 'navigation.menus.apps' })
const emptyStatus = () => screen.getByRole('status', { name: '' })
const openTagFilter = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('combobox', { name: 'common.tag.placeholder' }))
  await user.click(await screen.findByRole('option', { name: 'Research' }))
  await user.keyboard('{Escape}')
}

const learnApp = {
  app_id: 'learn-dify-template',
  app: {
    id: 'learn-dify-template-source',
    mode: 'chat',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#fff',
    icon_url: '',
    name: 'Learn Dify Template',
  },
  description: 'Learn how to build with Dify',
  copyright: '',
  privacy_policy: null,
  custom_disclaimer: null,
  categories: ['Assistant'],
  position: 1,
  is_listed: true,
  can_trial: true,
} satisfies RecommendedAppResponse

let intersect: ReturnType<typeof mockIntersectionObserver>

async function setup(
  searchParams = '',
  {
    waitForResults = true,
    ...options
  }: ConsoleQueryTestOptions & { waitForResults?: boolean } = {},
  tour?: StepByStepTourSessionState,
) {
  api.searchParams = new URLSearchParams(searchParams)
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
    accounts: [
      {
        id: 'creator-1',
        name: 'Alice',
        avatar_url: null,
        status: 'active',
        email: 'alice@example.test',
        role: 'admin',
      },
    ],
  })
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  if (tour) store.set(stepByStepTourSessionAtom, tour)
  const onUrlUpdate = vi.fn()
  const onCreateLearnDify = vi.fn()
  const onTryLearnDify = vi.fn()
  const list = <List onCreateLearnDify={onCreateLearnDify} onTryLearnDify={onTryLearnDify} />
  const route = (path: string, params: string, content: ReactNode) => (
    <JotaiProvider store={store}>
      <NuqsTestingAdapter key={path} hasMemory searchParams={params} onUrlUpdate={onUrlUpdate}>
        {content}
      </NuqsTestingAdapter>
    </JotaiProvider>
  )
  let rendered!: ReturnType<typeof renderWithConsoleQuery>
  await act(async () => {
    rendered = renderWithConsoleQuery(route('/apps', searchParams, list), {
      queryClient,
      accountProfile: { id: 'creator-1' },
      features: {},
      workspacePermissionKeys: ['app.create_and_management', 'app.tag.manage'],
      systemFeatures: {
        rbac_enabled: true,
        enable_learn_app: false,
        enable_collaboration_mode: false,
      },
      ...options,
    })
  })
  if (waitForResults)
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument(),
    )
  const navigate = async (href: string, content: ReactNode) => {
    const [path, params = ''] = href.split('?')
    api.searchParams = new URLSearchParams(params)
    await act(async () => rendered.rerender(route(path!, params, content)))
  }
  return {
    user: userEvent.setup(),
    onUrlUpdate,
    queryClient,
    onCreateLearnDify,
    onTryLearnDify,
    showDetail: () => navigate('/app/app-2/workflow', <AppDetailTop />),
    showList: (href: string) => navigate(href, list),
  }
}

beforeEach(() => {
  api.apps.mockReset().mockResolvedValue(page())
  api.delete.mockReset().mockResolvedValue(undefined)
  api.starred.mockReset().mockResolvedValue(page([]))
  api.online.mockReset().mockResolvedValue({ data: [] })
  api.learn.mockReset().mockResolvedValue({ recommended_apps: [learnApp] })
  api.push.mockReset()
  api.replace.mockReset()
  intersect = mockIntersectionObserver()
})
afterEach(() => vi.unstubAllGlobals())

it('renders real starred links before the workspace catalog', async () => {
  api.starred.mockResolvedValue(page([app({ id: 'starred', name: 'Starred app' })]))
  await setup()
  const lists = within(catalog()).getAllByRole('list')
  expect(lists[0]).toHaveAccessibleName('app.studio.starred')
  expect(lists[1]).toHaveAccessibleName('app.studio.allApps')
  expect(within(lists[0]!).getByRole('link', { name: 'Starred app' })).toHaveAttribute(
    'href',
    '/app/starred/configuration',
  )
  expect(within(lists[1]!).getByRole('link', { name: 'Workflow app' })).toHaveAttribute(
    'href',
    '/app/app-2/workflow',
  )
})

it('shows creation guidance only for an unfiltered empty workspace with creation access', async () => {
  api.apps.mockResolvedValue(page([]))
  const { user } = await setup()
  expect(screen.getByText('app.firstEmpty.title')).toBeInTheDocument()
  expect(screen.queryByText('app.firstEmpty.learnDifyTitle')).not.toBeInTheDocument()
  await user.type(search(), 'missing')
  expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
  await waitFor(() => expect(emptyStatus()).toHaveTextContent('app.filterEmpty.noApps'))
})

it('does not offer creation to a user without workspace creation permission', async () => {
  api.apps.mockResolvedValue(page([]))
  await setup('', { workspacePermissionKeys: [] })
  expect(emptyStatus()).toHaveTextContent('app.filterEmpty.noApps')
  expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.create' })).not.toBeInTheDocument()
})

it.each(['CLOUD', 'COMMUNITY'] as const)(
  'uses the real Learn Dify card for the %s action',
  async (edition) => {
    api.apps.mockResolvedValue(page([]))
    const { user, onCreateLearnDify, onTryLearnDify } = await setup('', {
      systemFeatures: { deployment_edition: edition, enable_learn_app: true },
    })
    await user.click(await screen.findByRole('button', { name: 'Learn Dify Template' }))
    expect(edition === 'CLOUD' ? onTryLearnDify : onCreateLearnDify).toHaveBeenCalledWith(learnApp)
    expect(edition === 'CLOUD' ? onCreateLearnDify : onTryLearnDify).not.toHaveBeenCalled()
  },
)

it('waits for both initial requests before announcing results', async () => {
  const main = createDeferred<Awaited<ReturnType<typeof api.apps>>>()
  const starred = createDeferred<Awaited<ReturnType<typeof api.starred>>>()
  api.apps.mockReturnValue(main.promise)
  api.starred.mockReturnValue(starred.promise)
  await setup('', { waitForResults: false })
  expect(screen.getAllByRole('status', { name: 'common.loading' })).toHaveLength(1)
  expect(screen.queryByText('app.firstEmpty.title')).not.toBeInTheDocument()
  await act(async () => main.resolve(page()))
  expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Chat app' })).not.toBeInTheDocument()
  await act(async () => starred.resolve(page([])))
  expect(await screen.findByRole('link', { name: 'Chat app' })).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
})

it('queries collaborators only for workflow apps when collaboration is enabled', async () => {
  await setup('', { systemFeatures: { enable_collaboration_mode: true } })
  await waitFor(() => expect(api.online).toHaveBeenCalledWith({ body: { app_ids: ['app-2'] } }))
})

it('combines real creator and tag selections with URL filters for both catalogs', async () => {
  const { user } = await setup('?keywords=sales&category=workflow')
  const scrollTo = vi.fn()
  catalog().scrollTo = scrollTo
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
  await user.click(await screen.findByRole('option', { name: /Alice/ }))
  await user.keyboard('{Escape}')
  await openTagFilter(user)
  const filters = {
    page: 1,
    name: 'sales',
    sort_by: 'last_modified',
    tag_ids: ['tag-1'],
    creator_ids: ['creator-1'],
    mode: 'workflow',
  }
  await waitFor(() =>
    expect(api.apps).toHaveBeenLastCalledWith({ query: { ...filters, limit: 30 } }),
  )
  expect(api.starred).toHaveBeenLastCalledWith({ query: { ...filters, limit: 100 } })
  expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
})

it('restores creator and tag filters from the URL for both catalogs', async () => {
  await setup(
    '?creatorIDs=creator-1&tagIDs=tag-1&category=workflow&keywords=sales&sort_by=earliest_created',
  )
  const filters = {
    page: 1,
    name: 'sales',
    sort_by: 'earliest_created',
    creator_ids: ['creator-1'],
    tag_ids: ['tag-1'],
    mode: 'workflow',
  }
  expect(api.apps).toHaveBeenLastCalledWith({ query: { ...filters, limit: 30 } })
  expect(api.starred).toHaveBeenLastCalledWith({ query: { ...filters, limit: 100 } })
  expect(screen.getByRole('combobox', { name: 'Research' })).toHaveTextContent('Research')
})

it('retains selected creators and tags through the workflow return link', async () => {
  const { user, onUrlUpdate, showDetail, showList } = await setup('?category=workflow')
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
  await user.click(await screen.findByRole('option', { name: /Alice/ }))
  await user.keyboard('{Escape}')
  await openTagFilter(user)
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('tagIDs')).toBe('tag-1'),
  )

  await showDetail()
  const href = screen.getByRole('link', { name: 'navigation.menus.apps' }).getAttribute('href')!
  const params = new URLSearchParams(href.split('?')[1])
  expect(params.get('creatorIDs')).toBe('creator-1')
  expect(params.get('tagIDs')).toBe('tag-1')
  expect(params.get('category')).toBe('workflow')

  await showList(href)
  expect(screen.getByRole('combobox', { name: 'Research' })).toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.creators' }))
  expect(await screen.findByRole('option', { name: /Alice/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(api.apps).toHaveBeenLastCalledWith({
    query: expect.objectContaining({
      creator_ids: ['creator-1'],
      tag_ids: ['tag-1'],
      mode: 'workflow',
    }),
  })
})

it('does not restore cleared creator and tag filters when returning from a workflow', async () => {
  const { user, onUrlUpdate, showDetail, showList } = await setup(
    '?creatorIDs=creator-1&tagIDs=tag-1',
  )
  await user.click(screen.getByRole('button', { name: 'app.studio.filters.reset' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  await waitFor(() => expect(onUrlUpdate.mock.lastCall?.[0].searchParams.toString()).toBe(''))
  await showDetail()
  expect(screen.getByRole('link', { name: 'navigation.menus.apps' })).toHaveAttribute(
    'href',
    '/apps',
  )
  await showList('/apps')
  expect(screen.queryByRole('button', { name: 'app.studio.filters.reset' })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'common.tag.placeholder' })).toBeInTheDocument()
  expect(api.apps).toHaveBeenLastCalledWith({
    query: expect.not.objectContaining({
      creator_ids: expect.anything(),
      tag_ids: expect.anything(),
    }),
  })
})

it('keeps previous main and starred cards while search resolves and announces empty results afterwards', async () => {
  api.starred.mockResolvedValue(page([app({ id: 'starred', name: 'Starred app' })]))
  const { user } = await setup()
  const main = createDeferred<Awaited<ReturnType<typeof api.apps>>>()
  const starred = createDeferred<Awaited<ReturnType<typeof api.starred>>>()
  api.apps.mockReturnValue(main.promise)
  api.starred.mockReturnValue(starred.promise)
  await user.type(search(), 'missing')
  await waitFor(() =>
    expect(api.apps).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ name: 'missing' }),
    }),
  )
  expect(screen.getByRole('link', { name: 'Chat app' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Starred app' })).toBeInTheDocument()
  expect(emptyStatus()).toBeEmptyDOMElement()
  await act(async () => {
    main.resolve(page([]))
    starred.resolve(page([]))
  })
  await waitFor(() => expect(emptyStatus()).toHaveTextContent('app.filterEmpty.noApps'))
  expect(screen.queryByRole('link', { name: 'Chat app' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Starred app' })).not.toBeInTheDocument()
})

it('keeps a settled empty announcement during background refresh', async () => {
  api.apps.mockResolvedValue(page([]))
  const { queryClient } = await setup('?keywords=missing')
  api.apps.mockReturnValue(createDeferred<Awaited<ReturnType<typeof api.apps>>>().promise)
  act(() => {
    void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
  })
  await waitFor(() => expect(api.apps).toHaveBeenCalledTimes(2))
  expect(emptyStatus()).toHaveTextContent('app.filterEmpty.noApps')
})

it('clears search in the URL and restores the unfiltered catalog', async () => {
  api.apps.mockImplementation(async ({ query }: Parameters<typeof api.apps>[0] = {}) =>
    page(query?.name ? [] : apps),
  )
  const { user, onUrlUpdate } = await setup('?keywords=missing')
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(search()).toHaveValue('')
  await waitFor(() =>
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('keywords')).toBe(false),
  )
  expect(await screen.findByRole('link', { name: 'Chat app' })).toBeInTheDocument()
})

it.each([
  ['workflow', 'app.types.workflow'],
  ['advanced-chat', 'app.types.advanced'],
  ['chat', 'app.types.chatbot'],
  ['agent-chat', 'app.types.agent'],
  ['completion', 'app.newApp.completeApp'],
])('synchronizes the %s category with URL and service queries', async (mode, label) => {
  const { user, onUrlUpdate } = await setup()
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.types' }))
  await user.click(await screen.findByRole('option', { name: label }))
  await waitFor(() =>
    expect(api.apps).toHaveBeenLastCalledWith({ query: expect.objectContaining({ mode }) }),
  )
  expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('category')).toBe(mode)
})

it('clears category selection back to all apps', async () => {
  const { user, onUrlUpdate } = await setup('?category=workflow')
  await user.click(screen.getByRole('combobox', { name: 'app.studio.filters.types' }))
  expect(screen.getByRole('option', { name: 'app.types.workflow' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await user.click(screen.getByRole('option', { name: 'app.types.all' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('category')).toBe(false),
  )
  expect(api.apps).toHaveBeenLastCalledWith({
    query: expect.not.objectContaining({ mode: expect.anything() }),
  })
})

it('ignores unsupported categories from the URL', async () => {
  await setup('?category=channel')
  expect(api.apps).toHaveBeenCalledWith({
    query: expect.not.objectContaining({ mode: expect.anything() }),
  })
})

it.each([
  ['earliest_created', 'earliest_created', 'app.studio.sort.earliestCreated'],
  ['invalid', 'last_modified', 'app.studio.sort.lastModified'],
])('resolves URL sort %s for the control and query', async (value, expected, label) => {
  await setup(`?sort_by=${value}`)
  expect(screen.getByRole('combobox', { name: 'app.studio.sort.sortBy' })).toHaveTextContent(label)
  expect(api.apps).toHaveBeenCalledWith({ query: expect.objectContaining({ sort_by: expected }) })
})

it('changes sorting without losing filters and resets catalog scroll', async () => {
  const { user, onUrlUpdate } = await setup('?category=workflow&keywords=sales')
  const scrollTo = vi.fn()
  catalog().scrollTo = scrollTo
  await user.click(screen.getByRole('combobox', { name: 'app.studio.sort.sortBy' }))
  await user.click(screen.getByRole('option', { name: 'app.studio.sort.recentlyCreated' }))
  await waitFor(() =>
    expect(api.apps).toHaveBeenLastCalledWith({
      query: expect.objectContaining({
        sort_by: 'recently_created',
        mode: 'workflow',
        name: 'sales',
      }),
    }),
  )
  const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams
  expect(params?.get('category')).toBe('workflow')
  expect(params?.get('keywords')).toBe('sales')
  expect(params?.get('sort_by')).toBe('recently_created')
  expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  await user.click(screen.getByRole('combobox', { name: 'app.studio.sort.sortBy' }))
  await user.click(screen.getByRole('option', { name: 'app.studio.sort.lastModified' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('sort_by')).toBe(false),
  )
})

it.each([
  ['app.newApp.startFromBlank', 'app.newApp.startFromBlank'],
  ['app.newApp.startFromTemplate', 'app.newApp.startFromTemplate'],
  ['app.importApp', 'app.importApp'],
])('opens the real %s creation dialog from the menu', async (label, title) => {
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(label) }))
  const dialog = await screen.findByRole('dialog', { name: title })
  await user.click(within(dialog).getByRole('button', { name: /^(Close|common.operation.close)$/ }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it('opens a real blank-app form from the first empty state', async () => {
  api.apps.mockResolvedValue(page([]))
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: /app.newApp.startFromBlank/ }))
  const dialog = await screen.findByRole('dialog', { name: 'app.newApp.startFromBlank' })
  expect(within(dialog).getByRole('textbox', { name: 'app.newApp.name' })).toBeInTheDocument()
})

it('opens DSL import with the file dropped on the app list', async () => {
  await setup()
  const file = new File(
    ['version: 0.1.0\nkind: app\napp:\n  name: Imported app\n  mode: chat'],
    'example.yml',
    { type: 'application/yaml' },
  )
  fireEvent.drop(catalog(), { dataTransfer: { files: [file], types: ['Files'] } })
  const dialog = await screen.findByRole('dialog', { name: 'app.importApp' })
  expect(within(dialog).getByText('example.yml')).toBeInTheDocument()
})

it('opens real tag management from the list filter', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('combobox', { name: 'common.tag.placeholder' }))
  await user.click(screen.getByRole('button', { name: 'common.tag.manageTags' }))
  const dialog = await screen.findByRole('dialog', { name: 'common.tag.manageTags' })
  expect(within(dialog).getByRole('textbox', { name: 'common.tag.addNew' })).toBeInTheDocument()
})

it('does not paginate repeatedly while a page is pending or after the last page', async () => {
  const next = createDeferred<Awaited<ReturnType<typeof api.apps>>>()
  api.apps.mockResolvedValueOnce(page(apps, 1, true)).mockReturnValue(next.promise)
  await setup()
  intersect(false)
  expect(api.apps).toHaveBeenCalledTimes(1)
  intersect()
  await waitFor(() => expect(api.apps).toHaveBeenCalledTimes(2))
  intersect()
  expect(api.apps).toHaveBeenCalledTimes(2)
  await act(async () => next.resolve(page([app({ id: 'app-3', name: 'Third app' })], 2)))
  expect(await screen.findByRole('link', { name: 'Third app' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Chat app' })).toBeInTheDocument()
  expect(api.apps).toHaveBeenLastCalledWith({ query: expect.objectContaining({ page: 2 }) })
  intersect()
  expect(api.apps).toHaveBeenCalledTimes(2)
})

it('does not paginate previous results while a changed filter is pending', async () => {
  api.apps
    .mockResolvedValueOnce(page(apps, 1, true))
    .mockReturnValue(createDeferred<Awaited<ReturnType<typeof api.apps>>>().promise)
  const { user } = await setup()
  await openTagFilter(user)
  await waitFor(() => expect(api.apps).toHaveBeenCalledTimes(2))
  intersect()
  expect(api.apps).toHaveBeenCalledTimes(2)
  expect(api.apps).toHaveBeenLastCalledWith({
    query: expect.objectContaining({ page: 1, tag_ids: ['tag-1'] }),
  })
})

it('keeps the main catalog available when starred apps fail to load', async () => {
  api.starred.mockRejectedValue(new Error('Starred request failed'))
  await setup()
  expect(await screen.findByRole('link', { name: 'Chat app' })).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'app.studio.starred' })).not.toBeInTheDocument()
})

it('preserves loaded cards and retries a failed next page', async () => {
  api.apps
    .mockResolvedValueOnce(page(apps, 1, true))
    .mockRejectedValueOnce(new Error('Page failed'))
    .mockResolvedValue(page([app({ id: 'app-3', name: 'Third app' })], 2))
  const { user } = await setup()
  intersect()
  const retry = await screen.findByRole('button', { name: 'common.operation.retry' })
  expect(screen.getByRole('link', { name: 'Chat app' })).toBeInTheDocument()
  await user.click(retry)
  expect(await screen.findByRole('link', { name: 'Third app' })).toBeInTheDocument()
  expect(api.apps).toHaveBeenCalledTimes(3)
  expect(api.apps).toHaveBeenLastCalledWith({ query: expect.objectContaining({ page: 2 }) })
})

it('opens only the first real app action menu for the manage-app tour', async () => {
  await setup(
    '',
    {},
    { activeTaskId: 'studio', activeGuideGroup: 'studioWithApps', activeGuideIndex: 1 },
  )
  const menus = screen.getAllByRole('menu', { hidden: true })
  expect(menus).toHaveLength(1)
  expect(
    within(menus[0]!).getByRole('menuitem', { name: 'app.editApp', hidden: true }),
  ).toBeInTheDocument()
  expect(menus[0]).toHaveAttribute('aria-hidden', 'true')
})

it('opens the create walkthrough after resolving the guide group without activating its actions', async () => {
  await setup('', {}, { activeTaskId: 'studio', activeGuideIndex: 0 })
  const menu = await screen.findByRole('menu', { hidden: true })
  expect(menu).toHaveAttribute('aria-hidden', 'true')
  // This is a presentation-only tour surface; a direct event must not create an app either.
  fireEvent.click(
    within(menu).getByRole('menuitem', { name: /app.newApp.startFromBlank/, hidden: true }),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>, appName = 'Chat app') {
  const card = screen.getByRole('link', { name: appName }).closest('li')!
  await user.click(within(card).getByRole('button', { name: /common\.operation\.moreActionsFor/ }))
  await user.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
  return screen.findByRole('textbox')
}

it('clears the failed deletion and confirmation name when reopening the catalog dialog', async () => {
  api.apps.mockResolvedValue(page([app({ permission_keys: [AppACLPermission.Delete] })]))
  api.delete.mockRejectedValueOnce(new Error('Delete failed'))
  const { user } = await setup()
  await user.type(await openDeleteDialog(user), 'Chat app')
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(await openDeleteDialog(user)).toHaveValue('')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
})

it('retains a failed catalog deletion for retry and closes after success', async () => {
  api.apps.mockResolvedValue(page([app({ permission_keys: [AppACLPermission.Delete] })]))
  api.delete.mockRejectedValueOnce(new Error('Delete failed'))
  const { user } = await setup()
  await user.type(await openDeleteDialog(user), 'Chat app')
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed')
  expect(screen.getByRole('textbox')).toHaveValue('Chat app')
  expect(api.delete).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
  api.apps.mockResolvedValue(page([]))
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.delete).toHaveBeenCalledTimes(2)
})

it('keeps the confirmation name stable and blocks dismissal while catalog deletion is pending', async () => {
  const target = app({ permission_keys: [AppACLPermission.Delete] })
  api.apps.mockResolvedValue(page([target]))
  const pending = createDeferred<void>()
  api.delete.mockReturnValueOnce(pending.promise)
  const { user, queryClient } = await setup()
  await openDeleteDialog(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.fill' }))
  api.apps.mockResolvedValue(page([{ ...target, name: 'Renamed elsewhere' }]))
  await act(async () => queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }))
  expect(screen.getByRole('textbox')).toHaveValue('Chat app')
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(api.delete).toHaveBeenCalledOnce())
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
  expect(screen.getByRole('button', { name: 'common.operation.fill' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  api.apps.mockResolvedValue(page([]))
  await act(async () => pending.resolve())
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

it('requires the exact app name and supports autofill before deleting from the catalog', async () => {
  api.apps.mockResolvedValue(page([app({ permission_keys: [AppACLPermission.Delete] })]))
  const { user } = await setup()
  const input = await openDeleteDialog(user)
  await user.type(input, 'Chat')
  expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
  await user.keyboard('{Enter}')
  expect(api.delete).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.fill' }))
  expect(input).toHaveValue('Chat app')
  api.apps.mockResolvedValue(page([]))
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.delete).toHaveBeenCalledExactlyOnceWith({ params: { app_id: 'app-1' } })
})
