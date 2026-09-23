import type {
  InstalledAppListResponse,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import { renderToReadableStream } from 'react-dom/server.node'
import WebAppsSection from '../web-apps-section'

vi.mock('@tanstack/react-virtual')

const service = vi.hoisted(() => ({
  list: vi.fn<() => Promise<InstalledAppListResponse>>(),
  pin: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/context/permission-state', async () => {
  const { atom } = await import('jotai')
  return { workspacePermissionKeysAtom: atom(['app_library.access']) }
})
vi.mock('@/service/console', () => ({
  consoleQuery: {
    installedApps: {
      get: {
        infiniteOptions: (options: {
          input: (cursor?: string) => { query: { name?: string } }
        }) => ({
          ...options,
          queryKey: ['installed-apps', options.input().query.name ?? ''],
          queryFn: () => service.list(),
        }),
      },
      byInstalledAppId: {
        patch: { mutationOptions: () => ({ mutationFn: service.pin }) },
      },
    },
  },
}))

function createApp(index: number): InstalledAppResponse {
  return {
    id: `installed-${index}`,
    app_owner_tenant_id: 'tenant-1',
    editable: true,
    last_used_at: null,
    is_pinned: index === 0,
    app: {
      id: `app-${index}`,
      mode: 'chat',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#fff',
      icon_url: null,
      name: `App ${index}`,
      description: '',
      use_icon_as_answer_icon: false,
    },
  }
}

async function renderSection(count = 2) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  service.list.mockResolvedValue({
    installed_apps: Array.from({ length: count }, (_, index) => createApp(index)),
    has_more: false,
    next_cursor: null,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <WebAppsSection />
    </QueryClientProvider>,
  )
  await screen.findByRole('link', { name: 'App 0' })
  return { queryClient, user: userEvent.setup() }
}

beforeEach(() => {
  vi.clearAllMocks()
  service.pin.mockResolvedValue(undefined)
})

it('leaves only the web apps fallback on the server without running its client providers', async () => {
  const onError = vi.fn()
  const onBrowserBailout = vi.fn()
  const stream = await renderToReadableStream(
    <>
      <nav aria-label="Primary">Studio</nav>
      <Suspense fallback={<span>Web apps fallback</span>}>
        <WebAppsSection />
      </Suspense>
    </>,
    { onError, onBrowserBailout },
  )
  const html = await new Response(stream).text()
  expect(html).toContain('<nav aria-label="Primary">Studio</nav>')
  expect(html).toContain('<span>Web apps fallback</span>')
  expect(onError).not.toHaveBeenCalled()
  expect(onBrowserBailout).toHaveBeenCalledOnce()
})

it.each([
  { index: 0, action: 'unpin', nextPinned: false },
  { index: 1, action: 'pin', nextPinned: true },
])(
  'offers $action without a delete action for installed web apps',
  async ({ index, action, nextPinned }) => {
    const { user } = await renderSection()
    await user.click(
      screen.getByRole('button', {
        name: `common.operation.moreActionsFor:{"name":"App ${index}"}`,
      }),
    )
    const pinAction = await screen.findByRole('menuitem', {
      name: `explore.sidebar.action.${action}`,
    })
    expect(
      screen.queryByRole('menuitem', { name: 'explore.sidebar.action.delete' }),
    ).not.toBeInTheDocument()

    await user.click(pinAction)

    await waitFor(() =>
      expect(service.pin).toHaveBeenCalledWith(
        {
          params: { installed_app_id: `installed-${index}` },
          body: { is_pinned: nextPinned },
        },
        expect.anything(),
      ),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
)

it('keeps the search input focused when a refresh removes all apps', async () => {
  const { queryClient, user } = await renderSection(1)
  await user.click(screen.getByRole('button', { name: 'common.operation.search' }))
  const search = screen.getByRole('searchbox')
  expect(search).toHaveFocus()
  service.list.mockResolvedValue({ installed_apps: [], has_more: false, next_cursor: null })
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['installed-apps'] })
  })
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('common.mainNav.webApps.noResults'),
  )
  expect(search).toHaveFocus()
})

it('keeps focus when clearing empty search results after the unfiltered cache expires', async () => {
  const { queryClient, user } = await renderSection()
  const toggle = screen.getByRole('button', { name: 'common.operation.search' })
  await user.click(toggle)
  service.list.mockResolvedValue({ installed_apps: [], has_more: false, next_cursor: null })
  await user.type(screen.getByRole('searchbox'), 'missing app')
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('common.mainNav.webApps.noResults'),
  )
  queryClient.removeQueries({ queryKey: ['installed-apps', ''] })
  let finish!: (value: InstalledAppListResponse) => void
  service.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await user.click(toggle)
  try {
    expect(toggle).toHaveFocus()
  } finally {
    await act(async () => {
      finish({ installed_apps: [createApp(0)], has_more: false, next_cursor: null })
    })
  }
  expect(await screen.findByRole('link', { name: 'App 0' })).toBeInTheDocument()
})
