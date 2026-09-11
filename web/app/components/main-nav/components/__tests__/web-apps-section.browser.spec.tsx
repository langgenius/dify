import type {
  InstalledAppListResponse,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import WebAppsSection from '../web-apps-section'

const service = vi.hoisted(() => ({
  list: vi.fn<() => Promise<InstalledAppListResponse>>(),
  remove: vi.fn<() => Promise<void>>(),
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
        delete: { mutationOptions: () => ({ mutationFn: service.remove }) },
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
    uninstallable: false,
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

async function renderSection(count = 40) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  service.list.mockResolvedValue({
    installed_apps: Array.from({ length: count }, (_, index) => createApp(index)),
    has_more: false,
    next_cursor: null,
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <div className="flex h-64 w-60 flex-col bg-background-body text-text-primary">
        <Suspense fallback={null}>
          <WebAppsSection />
        </Suspense>
      </div>
      <button type="button">After apps</button>
    </QueryClientProvider>,
  )
  await expect
    .element(
      screen.getByRole('link', {
        name: 'App 0',
        exact: true,
      }),
    )
    .toBeVisible()
  return { screen, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  service.remove.mockResolvedValue(undefined)
  service.pin.mockResolvedValue(undefined)
})

it('keeps a focused app mounted when the list scrolls away', async () => {
  const { screen } = await renderSection()
  const firstApp = screen.getByRole('link', {
    name: 'App 0',
    exact: true,
  })
  firstApp.element().focus()
  const viewport = screen.getByRole('navigation', { name: 'explore.sidebar.webApps' })
  viewport.element().scrollTo({ top: 1000 })
  await expect
    .element(
      screen.getByRole('link', {
        name: 'App 35',
        exact: true,
      }),
    )
    .toBeVisible()
  await expect.element(firstApp).toHaveFocus()
  await userEvent.keyboard('{Tab}{Tab}')
  await expect
    .element(
      screen.getByRole('link', {
        name: 'App 1',
        exact: true,
      }),
    )
    .toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{Tab}{/Shift}')
  await expect.element(firstApp).toHaveFocus()
})

it('tabs through the virtualized apps and can leave the list', async () => {
  const { screen } = await renderSection(20)
  const firstApp = screen.getByRole('link', {
    name: 'App 0',
    exact: true,
  })
  firstApp.element().focus()
  for (let index = 0; index < 20; index++) {
    await expect
      .element(
        screen.getByRole('link', {
          name: `App ${index}`,
          exact: true,
        }),
      )
      .toHaveFocus()
    await userEvent.keyboard('{Tab}{Tab}')
  }
  await expect.element(screen.getByRole('button', { name: 'After apps' })).toHaveFocus()
})

it('does not flash a scrollbar when rapidly toggling a list that fits', async () => {
  const { screen } = await renderSection(2)
  const toggle = screen.getByRole('button', { name: 'explore.sidebar.webApps' })
  const frames: { viewportHeight: number; contentHeight: number; hasOverflow: boolean }[] = []
  let frame = 0
  const sample = () => {
    const viewport = screen.getByRole('navigation', { name: 'explore.sidebar.webApps' }).query()
    if (viewport) {
      frames.push({
        viewportHeight: viewport.clientHeight,
        contentHeight: viewport.scrollHeight,
        hasOverflow: viewport.hasAttribute('data-has-overflow-y'),
      })
    }
    frame = requestAnimationFrame(sample)
  }
  frame = requestAnimationFrame(sample)
  try {
    for (let index = 0; index < 12; index++) await toggle.click()
    await expect.element(screen.getByRole('link', { name: 'App 0', exact: true })).toBeVisible()
  } finally {
    cancelAnimationFrame(frame)
  }
  expect(frames.length).toBeGreaterThan(0)
  for (const snapshot of frames) {
    expect(snapshot.viewportHeight).toBeGreaterThanOrEqual(snapshot.contentHeight)
    expect(snapshot.hasOverflow).toBe(false)
  }
})
