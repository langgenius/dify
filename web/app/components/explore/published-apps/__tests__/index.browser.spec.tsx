import type {
  GetInstalledAppsData,
  InstalledAppListResponse,
  InstalledAppParametersResponse,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page as browserPage, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import PublishedApps from '..'

const service = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn<(id: string) => Promise<InstalledAppResponse>>(),
  pin: vi.fn(),
  parameters: vi.fn(),
  metadata: vi.fn(),
  urlUpdate: vi.fn(),
}))

setupFakeApi({
  console: {
    installedApps: {
      get: (input) => service.list(input),
      byInstalledAppId: {
        get: ({ params }) => service.detail(params.installed_app_id),
        patch: (input) => service.pin(input),
        parameters: { get: ({ params }) => service.parameters(params.installed_app_id) },
        meta: { get: ({ params }) => service.metadata(params.installed_app_id) },
      },
    },
  },
})

const appIds = {
  first: '019a0000-0000-7000-8000-000000000001',
  second: '019a0000-0000-7000-8000-000000000002',
  workflow: '019a0000-0000-7000-8000-000000000003',
}
// Chat engine behavior is covered separately; this retains the installed runtime's real metadata wiring.
// boundary: isolates the app catalog from the embedded chat runtime.
vi.mock('@/app/components/base/chat/chat-with-history', async () => {
  const { useWebAppStore } = await import('@/context/web-app-context')
  return {
    default: function ChatSurface() {
      const appName = useWebAppStore((state) => state.appInfo?.site.title)
      return (
        <section aria-label="Installed chat">
          <h2>{appName}</h2>
        </section>
      )
    },
  }
})

function createApp(
  label: keyof typeof appIds,
  isPinned = false,
  mode: InstalledAppResponse['app']['mode'] = 'chat',
): InstalledAppResponse {
  return {
    id: appIds[label],
    app_owner_tenant_id: 'tenant-1',
    editable: true,
    last_used_at: null,
    is_pinned: isPinned,
    app: {
      id: `app-${label}`,
      mode,
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#fff',
      icon_url: null,
      name: `Assistant ${label}`,
      description: 'Published assistant',
      use_icon_as_answer_icon: false,
    },
  }
}

const parameters: InstalledAppParametersResponse = {
  annotation_reply: {},
  connection_requirements: [],
  connection_revision: null,
  requires_end_user_connections: false,
  file_upload: {},
  more_like_this: {},
  retriever_resource: {},
  sensitive_word_avoidance: {},
  speech_to_text: {},
  suggested_questions: [],
  suggested_questions_after_answer: {},
  system_parameters: {
    audio_file_size_limit: 10,
    file_size_limit: 15,
    image_file_size_limit: 10,
    video_file_size_limit: 100,
    workflow_file_upload_limit: 10,
  },
  text_to_speech: {},
  user_input_form: [],
}

let apps: InstalledAppResponse[]
function page(installedApps = apps, nextCursor: string | null = null): InstalledAppListResponse {
  return { installed_apps: installedApps, has_more: nextCursor !== null, next_cursor: nextCursor }
}

async function renderPublished(searchParams = '') {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['app_library.access'],
    systemFeatures: { webapp_auth: { enabled: false } },
  })
  const { NavigationProvider } = createTestNavigation({ url: `/published-apps?${searchParams}` })
  return render(
    <Wrapper>
      <NuqsTestingAdapter searchParams={searchParams} hasMemory onUrlUpdate={service.urlUpdate}>
        <NavigationProvider>
          <PublishedApps />
        </NavigationProvider>
      </NuqsTestingAdapter>
    </Wrapper>,
  )
}

beforeEach(() => {
  apps = [createApp('first'), createApp('second')]
  service.list.mockReset().mockImplementation(async () => page())
  service.detail.mockReset().mockImplementation(async (id) => {
    const app = apps.find((entry) => entry.id === id)
    if (!app) throw apiError({ status: 404, message: 'Installed app missing' })
    return app
  })
  service.parameters.mockReset().mockResolvedValue(parameters)
  service.metadata.mockReset().mockResolvedValue({ tool_icons: {} })
  service.pin.mockReset().mockImplementation(async ({ params, body }) => {
    apps = apps.map((app) =>
      app.id === params.installed_app_id ? { ...app, is_pinned: body.is_pinned } : app,
    )
    return { result: 'success', message: 'updated' }
  })
})

it('shows a single card focus ring and moves the focus indicator to the star on Tab', async () => {
  const screen = await renderPublished()
  const card = screen.getByRole('button', { name: 'Assistant first', exact: true })
  const star = screen.getByRole('button', {
    name: 'app.endUser.starApp:{"name":"Assistant first"}',
  })
  await expect.element(card).toBeVisible()
  screen.getByRole('combobox', { name: 'app.studio.sort.sortBy' }).element().focus()

  await userEvent.keyboard('{Tab}')
  await expect.element(card).toHaveFocus()
  expect(getComputedStyle(card.element()).boxShadow).not.toContain('0px 0px 0px 2px')
  expect(getComputedStyle(card.element(), '::after').boxShadow).toContain('inset')

  await userEvent.keyboard('{Tab}')
  await expect.element(star).toHaveFocus()
  expect(getComputedStyle(card.element(), '::after').boxShadow).toBe('none')
  expect(getComputedStyle(star.element()).boxShadow).not.toBe('none')
})

it.each([
  { viewport: 'desktop', width: 1440, height: 900 },
  { viewport: 'narrow', width: 390, height: 660 },
])('opens a full-screen app dialog on $viewport', async ({ width, height }) => {
  await browserPage.viewport(width, height)
  const screen = await renderPublished()
  const card = screen.getByRole('button', { name: 'Assistant second', exact: true })
  await expect.element(card).toBeVisible()
  expect(service.detail).not.toHaveBeenCalled()

  await card.click()
  const dialog = screen.getByRole('dialog', { name: 'navigation.mainNav.publishedApps' })
  await expect
    .element(dialog.getByRole('heading', { level: 2, name: 'Assistant second' }))
    .toBeVisible()
  expect(service.detail).toHaveBeenCalledExactlyOnceWith(appIds.second)
  expect(service.parameters).toHaveBeenCalledExactlyOnceWith(appIds.second)
  expect(service.metadata).toHaveBeenCalledExactlyOnceWith(appIds.second)

  const bounds = dialog.element().getBoundingClientRect()
  expect(bounds.width).toBeGreaterThan(width * 0.9)
  expect(bounds.height).toBeGreaterThan(height * 0.9)
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(width)
  expect(bounds.bottom).toBeLessThanOrEqual(height)

  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(card).toHaveFocus()
})

it('maps starring to the installed-app pin API and removes unstarred apps from the Starred view', async () => {
  const screen = await renderPublished()
  const starLabel = 'app.endUser.starApp:{"name":"Assistant second"}'
  await screen.getByRole('button', { name: starLabel }).click()
  await expect
    .element(
      screen.getByRole('button', { name: 'app.endUser.unstarApp:{"name":"Assistant second"}' }),
    )
    .toHaveAttribute('aria-pressed', 'true')
  await expect
    .element(screen.getByRole('button', { name: /common\.operation\.moreActionsFor/ }))
    .not.toBeInTheDocument()
  expect(service.pin).toHaveBeenCalledExactlyOnceWith({
    params: { installed_app_id: appIds.second },
    body: { is_pinned: true },
  })

  await screen.getByRole('radio', { name: 'app.endUser.starred' }).click()
  await expect.element(screen.getByRole('radio', { name: 'app.endUser.starred' })).toBeChecked()
  await expect
    .element(screen.getByRole('button', { name: 'Assistant first', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Assistant second', exact: true }))
    .toBeVisible()
  expect(service.urlUpdate.mock.lastCall?.[0].searchParams.get('view')).toBe('starred')

  await screen
    .getByRole('button', { name: 'app.endUser.unstarApp:{"name":"Assistant second"}' })
    .click()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('navigation.mainNav.webApps.noResults')
  expect(service.pin).toHaveBeenLastCalledWith({
    params: { installed_app_id: appIds.second },
    body: { is_pinned: false },
  })
})

it('loads subsequent installed-app pages before showing all starred applications', async () => {
  service.list.mockImplementation(async ({ query }: { query: { cursor?: string } }) =>
    query.cursor ? page([createApp('second', true)]) : page([createApp('first')], 'next-page'),
  )
  const screen = await renderPublished('view=starred')
  await expect
    .element(screen.getByRole('button', { name: 'Assistant second', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Assistant first', exact: true }))
    .not.toBeInTheDocument()
  expect(service.list).toHaveBeenCalledWith({
    query: { limit: 100, cursor: 'next-page', mode: 'all', sort_by: 'recently_created' },
  })
})

it('shows an empty state without opening a runtime when no apps are installed', async () => {
  apps = []
  const screen = await renderPublished()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('navigation.mainNav.webApps.noResults')
  expect(service.detail).not.toHaveBeenCalled()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('hides list errors without showing a false empty state and remains usable through filtering', async () => {
  const failedList = createDeferred()
  service.list.mockImplementation(
    async ({ query }: { query: NonNullable<GetInstalledAppsData['query']> }) => {
      if (query.mode === 'agent-chat') {
        await failedList.promise
        throw apiError({ status: 503, message: 'Published apps unavailable' })
      }
      return page([createApp('workflow', false, 'workflow')])
    },
  )
  const screen = await renderPublished('category=agent-chat')
  const loading = screen.getByRole('list', { name: 'common.loading' })
  await expect.element(loading).toBeVisible()
  failedList.resolve()
  await expect.element(loading).not.toBeInTheDocument()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(screen.getByText('Published apps unavailable')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'common.operation.retry' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()

  await screen.getByRole('combobox', { name: 'app.studio.filters.types' }).click()
  await screen.getByRole('option', { name: 'app.types.workflow' }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Assistant workflow', exact: true }))
    .toBeVisible()
  expect(service.list).toHaveBeenLastCalledWith({
    query: { limit: 100, cursor: undefined, mode: 'workflow', sort_by: 'recently_created' },
  })
  expect(service.urlUpdate.mock.lastCall?.[0].searchParams.get('category')).toBe('workflow')
})

it('falls back from the removed sort, offers creation sorts and preserves the selected sort when filtering', async () => {
  const first = createApp('first')
  const second = createApp('second')
  const workflow = createApp('workflow', false, 'workflow')
  service.list.mockImplementation(
    async ({ query }: { query: NonNullable<GetInstalledAppsData['query']> }) => {
      if (query.mode === 'workflow') return page([workflow])
      return query.sort_by === 'recently_created'
        ? page([workflow, second, first])
        : page([first, second, workflow])
    },
  )
  const screen = await renderPublished('sort_by=last_modified')
  const cardOrder = () =>
    screen
      .getByRole('button', { name: /^Assistant / })
      .elements()
      .map((card) => card.getAttribute('aria-label'))
  await expect
    .poll(cardOrder)
    .toEqual(['Assistant workflow', 'Assistant second', 'Assistant first'])

  const sort = screen.getByRole('combobox', { name: 'app.studio.sort.sortBy' })
  await expect
    .element(sort)
    .toHaveTextContent('app.studio.sort.sortBy app.studio.sort.recentlyCreated')
  expect(service.list).toHaveBeenLastCalledWith({
    query: { limit: 100, cursor: undefined, mode: 'all', sort_by: 'recently_created' },
  })
  await sort.click()
  await expect
    .element(screen.getByRole('option', { name: 'app.studio.sort.earliestCreated' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('option', { name: 'app.studio.sort.lastModified' }))
    .not.toBeInTheDocument()
  await screen.getByRole('option', { name: 'app.studio.sort.earliestCreated' }).click()
  await expect
    .poll(cardOrder)
    .toEqual(['Assistant first', 'Assistant second', 'Assistant workflow'])
  await expect
    .element(sort)
    .toHaveTextContent('app.studio.sort.sortBy app.studio.sort.earliestCreated')
  expect(service.list).toHaveBeenLastCalledWith({
    query: { limit: 100, cursor: undefined, mode: 'all', sort_by: 'earliest_created' },
  })
  expect(service.urlUpdate.mock.lastCall?.[0].searchParams.get('sort_by')).toBe('earliest_created')

  const types = screen.getByRole('combobox', { name: 'app.studio.filters.types' })
  await types.click()
  await screen.getByRole('option', { name: 'app.types.workflow' }).click()
  await expect.poll(cardOrder).toEqual(['Assistant workflow'])
  await expect.element(types).toHaveTextContent('app.types.workflow')
  expect(service.list).toHaveBeenLastCalledWith({
    query: { limit: 100, cursor: undefined, mode: 'workflow', sort_by: 'earliest_created' },
  })
  const url = service.urlUpdate.mock.lastCall?.[0].searchParams
  expect(url?.get('category')).toBe('workflow')
  expect(url?.get('sort_by')).toBe('earliest_created')
})

it('initializes filters from the URL and starts a fresh pagination cursor when the sort changes', async () => {
  const first = createApp('first')
  const second = createApp('second')
  service.list.mockImplementation(
    async ({ query }: { query: NonNullable<GetInstalledAppsData['query']> }) => {
      if (query.mode !== 'chat') throw new Error('Expected the URL-selected Chatbot category')
      if (query.sort_by === 'earliest_created')
        return query.cursor ? page([second]) : page([first], 'earliest-next')
      if (query.sort_by === 'recently_created')
        return query.cursor ? page([first]) : page([second], 'recent-next')
      throw new Error('Unexpected sort')
    },
  )
  const screen = await renderPublished('category=chat&sort_by=earliest_created')
  const cardOrder = () =>
    screen
      .getByRole('button', { name: /^Assistant / })
      .elements()
      .map((card) => card.getAttribute('aria-label'))
  await expect.poll(cardOrder).toEqual(['Assistant first', 'Assistant second'])
  await expect
    .element(screen.getByRole('combobox', { name: 'app.studio.filters.types' }))
    .toHaveTextContent('app.types.chatbot')
  expect(service.list.mock.calls).toEqual([
    [{ query: { limit: 100, cursor: undefined, mode: 'chat', sort_by: 'earliest_created' } }],
    [{ query: { limit: 100, cursor: 'earliest-next', mode: 'chat', sort_by: 'earliest_created' } }],
  ])

  const sort = screen.getByRole('combobox', { name: 'app.studio.sort.sortBy' })
  await sort.click()
  await screen.getByRole('option', { name: 'app.studio.sort.recentlyCreated' }).click()
  await expect.poll(cardOrder).toEqual(['Assistant second', 'Assistant first'])
  expect(service.list.mock.calls.slice(2)).toEqual([
    [{ query: { limit: 100, cursor: undefined, mode: 'chat', sort_by: 'recently_created' } }],
    [{ query: { limit: 100, cursor: 'recent-next', mode: 'chat', sort_by: 'recently_created' } }],
  ])
  const url = service.urlUpdate.mock.lastCall?.[0].searchParams
  expect(url?.get('category')).toBe('chat')
  expect(url?.get('sort_by')).toBeNull()
})
