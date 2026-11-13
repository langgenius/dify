import type {
  InstalledAppListResponse,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import { Suspense } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import WebAppsSection from '../web-apps-section'

const service = vi.hoisted(() => ({
  list: vi.fn<() => Promise<InstalledAppListResponse>>(),
  pin: vi.fn<() => Promise<void>>(),
}))

// boundary: Browser Mode has no Next App Router; the list consumes the current pathname.
vi.mock('@/next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'installedApps.get': () => service.list(),
      'installedApps.byInstalledAppId.patch': () => service.pin(),
    }),
  }
})

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

async function renderSection(count = 40) {
  onTestFinished(guardUnexpectedFetch())
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: true },
    workspacePermissionKeys: ['app_library.access'],
  })
  service.list.mockResolvedValue({
    installed_apps: Array.from({ length: count }, (_, index) => createApp(index)),
    has_more: false,
    next_cursor: null,
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <div className="flex h-64 w-60 flex-col bg-background-body text-text-primary">
        <Suspense fallback={null}>
          <WebAppsSection />
        </Suspense>
      </div>
      <button type="button">After apps</button>
    </QueryClientTestProvider>,
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
