import type {
  GetInstalledAppsData,
  InstalledAppListResponse,
  InstalledAppParametersResponse,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import PublishedApps from '..'

const service = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn<(id: string) => Promise<InstalledAppResponse>>(),
  pin: vi.fn(),
  parameters: vi.fn(),
  metadata: vi.fn(),
  urlUpdate: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/published-apps',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const installedId = (input: { params: { installed_app_id: string } }) =>
    input.params.installed_app_id
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'installedApps.get': (input) => service.list(input),
      'installedApps.byInstalledAppId.get': (input) => service.detail(installedId(input)),
      'installedApps.byInstalledAppId.patch': (input) => service.pin(input),
      'installedApps.byInstalledAppId.parameters.get': (input) =>
        service.parameters(installedId(input)),
      'installedApps.byInstalledAppId.meta.get': (input) => service.metadata(installedId(input)),
    }),
  }
})

// Chat engine behavior is covered separately; this retains the installed runtime's real metadata wiring.
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
  id: string,
  isPinned = false,
  mode: InstalledAppResponse['app']['mode'] = 'chat',
): InstalledAppResponse {
  return {
    id,
    app_owner_tenant_id: 'tenant-1',
    editable: true,
    last_used_at: null,
    is_pinned: isPinned,
    app: {
      id: `app-${id}`,
      mode,
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#fff',
      icon_url: null,
      name: `Assistant ${id}`,
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
  return render(
    <Wrapper>
      <NuqsTestingAdapter searchParams={searchParams} hasMemory onUrlUpdate={service.urlUpdate}>
        <PublishedApps />
      </NuqsTestingAdapter>
    </Wrapper>,
  )
}

beforeEach(() => {
  apps = [createApp('first'), createApp('second')]
  service.list.mockReset().mockImplementation(async () => page())
  service.detail.mockReset().mockImplementation(async (id) => createApp(id))
  service.parameters.mockReset().mockResolvedValue(parameters)
  service.metadata.mockReset().mockResolvedValue({ tool_icons: {} })
  service.pin.mockReset().mockImplementation(async ({ params, body }) => {
    apps = apps.map((app) =>
      app.id === params.installed_app_id ? { ...app, is_pinned: body.is_pinned } : app,
    )
    return { result: 'success', message: 'updated' }
  })
})

it('opens the selected installed app in a dialog and restores focus to its card on close', async () => {
  const screen = await renderPublished()
  const card = screen.getByRole('button', { name: 'Assistant second', exact: true })
  await expect.element(card).toBeVisible()
  expect(service.detail).not.toHaveBeenCalled()

  await card.click()
  const dialog = screen.getByRole('dialog', { name: 'navigation.mainNav.publishedApps' })
  await expect
    .element(dialog.getByRole('heading', { level: 2, name: 'Assistant second' }))
    .toBeVisible()
  expect(service.detail).toHaveBeenCalledExactlyOnceWith('second')
  expect(service.parameters).toHaveBeenCalledExactlyOnceWith('second')
  expect(service.metadata).toHaveBeenCalledExactlyOnceWith('second')
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
  expect(service.pin).toHaveBeenCalledExactlyOnceWith({
    params: { installed_app_id: 'second' },
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
    params: { installed_app_id: 'second' },
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
    query: { limit: 100, cursor: 'next-page', mode: 'all', sort_by: 'last_modified' },
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

it('keeps a failed list retryable rather than showing an empty result', async () => {
  service.list.mockRejectedValueOnce(new Error('Published apps unavailable'))
  const screen = await renderPublished()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Published apps unavailable')
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Assistant first', exact: true }))
    .toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
})

it('requests the selected sort and type, updates the URL and displays the server result order', async () => {
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
  const screen = await renderPublished()
  const cardOrder = () =>
    screen
      .getByRole('button', { name: /^Assistant / })
      .elements()
      .map((card) => card.getAttribute('aria-label'))
  await expect
    .poll(cardOrder)
    .toEqual(['Assistant first', 'Assistant second', 'Assistant workflow'])

  const sort = screen.getByRole('combobox', { name: 'app.studio.sort.sortBy' })
  await sort.click()
  await screen.getByRole('option', { name: 'app.studio.sort.recentlyCreated' }).click()
  await expect
    .poll(cardOrder)
    .toEqual(['Assistant workflow', 'Assistant second', 'Assistant first'])
  await expect
    .element(sort)
    .toHaveTextContent('app.studio.sort.sortBy app.studio.sort.recentlyCreated')
  expect(service.list).toHaveBeenLastCalledWith({
    query: { limit: 100, cursor: undefined, mode: 'all', sort_by: 'recently_created' },
  })
  expect(service.urlUpdate.mock.lastCall?.[0].searchParams.get('sort_by')).toBe('recently_created')

  const types = screen.getByRole('combobox', { name: 'app.studio.filters.types' })
  await types.click()
  await screen.getByRole('option', { name: 'app.types.workflow' }).click()
  await expect.poll(cardOrder).toEqual(['Assistant workflow'])
  await expect.element(types).toHaveTextContent('app.types.workflow')
  expect(service.list).toHaveBeenLastCalledWith({
    query: { limit: 100, cursor: undefined, mode: 'workflow', sort_by: 'recently_created' },
  })
  const url = service.urlUpdate.mock.lastCall?.[0].searchParams
  expect(url?.get('category')).toBe('workflow')
  expect(url?.get('sort_by')).toBe('recently_created')
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
  expect(url?.get('sort_by')).toBe('recently_created')
})
