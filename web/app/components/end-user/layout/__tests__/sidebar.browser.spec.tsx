import type {
  WebAccountProfileResponse,
  WebSystemFeatureResponse,
} from '@dify/contracts/api/web/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from 'vitest-browser-react'
import { startWebAppAccountSession } from '@/service/webapp-auth'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import Sidebar from '../sidebar'

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/my-apps',
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const buildAppLabel = 'app.endUser.buildYourOwnApp'
const accountLabel = 'app.endUser.account'
const profile: WebAccountProfileResponse = {
  name: 'Joel',
  avatar: null,
  avatar_url: null,
  has_owned_tenant: false,
  has_tenant: false,
}
const features = {
  ...createSystemFeaturesFixture(),
  account_login_url: 'https://console.example.com/dify/signin',
} satisfies WebSystemFeatureResponse
const clients: ReturnType<typeof createTestQueryClient>[] = []

function renderSidebar() {
  const queryClient = createTestQueryClient()
  clients.push(queryClient)
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar />
    </QueryClientProvider>,
  )
}

function mockRequests({
  account = () => Response.json(profile),
  systemFeatures = () => Response.json(features),
}: {
  account?: () => Response | Promise<Response>
  systemFeatures?: () => Response | Promise<Response>
} = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (path.endsWith('/account/profile')) return account()
    if (path.endsWith('/system-features')) return systemFeatures()
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

describe('sidebar workspace entry', () => {
  it.each([
    { hasTenant: true, destination: 'https://console.example.com/dify/' },
    { hasTenant: false, destination: 'https://console.example.com/dify/create-workspace' },
  ])('routes to $destination based on workspace membership', async ({ hasTenant, destination }) => {
    const fetch = mockRequests({
      account: () => Response.json({ ...profile, has_tenant: hasTenant }),
    })
    const screen = await renderSidebar()

    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', destination)
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/account')
    await expect
      .element(screen.getByRole('link', { name: 'app.endUser.myApps' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(screen.getByText(profile.name)).toBeVisible()

    const profileCall = fetch.mock.calls.find(([input, init]) =>
      new URL(new Request(input, init).url).pathname.endsWith('/account/profile'),
    )
    expect(profileCall).toBeDefined()
    const request = new Request(...profileCall!)
    expect(request.credentials).toBe('include')
    expect(request.headers.has('x-app-code')).toBe(false)
    expect(request.headers.has('x-app-passport')).toBe(false)
  })

  it('keeps the path prefix of a relative Console sign-in URL', async () => {
    mockRequests({
      systemFeatures: () => Response.json({ ...features, account_login_url: '/dify/signin' }),
    })
    const screen = await renderSidebar()

    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', '/dify/create-workspace')
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', '/dify/account')
  })

  it('waits for the Console prefix before exposing the workspace destination', async () => {
    const featuresRequest = createDeferred<Response>()
    mockRequests({
      account: () => Response.json({ ...profile, has_tenant: true }),
      systemFeatures: () => featuresRequest.promise,
    })
    const screen = await renderSidebar()

    await expect.element(screen.getByText(profile.name)).toBeVisible()
    await expect.element(screen.getByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('link', { name: accountLabel })).not.toBeInTheDocument()
    featuresRequest.resolve(Response.json(features))
    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/')
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/account')
  })

  it.each(['missing', 'failed'] as const)(
    'hides the workspace entry when the Console sign-in URL is %s',
    async (state) => {
      mockRequests({
        account: () => Response.json({ ...profile, has_tenant: true }),
        systemFeatures: () =>
          state === 'missing'
            ? Response.json({ ...features, account_login_url: null })
            : Response.json({ message: 'Features unavailable.' }, { status: 503 }),
      })
      const screen = await renderSidebar()

      await expect.element(screen.getByText(profile.name)).toBeVisible()
      await expect
        .element(screen.getByRole('link', { name: buildAppLabel }))
        .not.toBeInTheDocument()
      await expect.element(screen.getByRole('link', { name: accountLabel })).not.toBeInTheDocument()
    },
  )

  it('treats unavailable membership as no workspace', async () => {
    mockRequests({ account: () => Response.json({ ...profile, has_tenant: null }) })
    const screen = await renderSidebar()

    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/create-workspace')
  })

  it('treats a failed profile lookup as no workspace', async () => {
    mockRequests({
      account: () =>
        Response.json({ code: 'unavailable', message: 'Profile unavailable.' }, { status: 503 }),
    })
    const screen = await renderSidebar()

    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/create-workspace')
  })

  it('clears the previous account destination while loading the new account profile', async () => {
    const nextAccount = createDeferred<Response>()
    const account = vi
      .fn<() => Response | Promise<Response>>()
      .mockReturnValueOnce(Response.json({ ...profile, has_tenant: true }))
      .mockReturnValueOnce(nextAccount.promise)
    mockRequests({ account })
    const screen = await renderSidebar()
    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/')

    startWebAppAccountSession()
    await expect.element(screen.getByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
    nextAccount.resolve(Response.json({ ...profile, name: 'Alice' }))
    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/create-workspace')
    await expect.element(screen.getByText('Alice')).toBeVisible()
    expect(account).toHaveBeenCalledTimes(2)
  })
})
