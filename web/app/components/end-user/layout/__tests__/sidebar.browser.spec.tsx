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
import { installFakeApi, route } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import Sidebar from '../sidebar'

// boundary: keeps navigation tests independent of global toast presentation.
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const buildAppLabel = 'app.endUser.buildYourOwnApp'
const accountLabel = 'app.endUser.account'
const profile: WebAccountProfileResponse = {
  email: 'joel@example.com',
  is_password_set: false,
  interface_language: 'en-US',
  interface_theme: 'system',
  timezone: 'UTC',
  name: 'Joel',
  avatar: null,
  avatar_url: null,
  has_owned_tenant: false,
  has_tenant: false,
}
const features = {
  ...createSystemFeaturesFixture(),
  console_web_url: 'https://console.example.com/dify',
} satisfies WebSystemFeatureResponse
const clients: ReturnType<typeof createTestQueryClient>[] = []

function renderSidebar() {
  const queryClient = createTestQueryClient()
  clients.push(queryClient)
  const { NavigationProvider } = createTestNavigation({ url: '/my-apps' })
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <Sidebar />
      </NavigationProvider>
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
  const fake = installFakeApi({
    routes: [
      route('GET', 'public', '/account/profile', account),
      route('GET', 'public', '/system-features', systemFeatures),
    ],
  })
  onTestFinished(fake)
  return fake.route('GET', 'public', '/account/profile')
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
    const account = mockRequests({
      account: () => Response.json({ ...profile, has_tenant: hasTenant }),
    })
    const screen = await renderSidebar()

    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', destination)
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', '/my-account')
    await expect
      .element(screen.getByRole('link', { name: 'app.endUser.myApps' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(screen.getByText(profile.name)).toBeVisible()

    const { request } = account.mock.calls[0]![0]
    expect(request.credentials).toBe('include')
    expect(request.headers.has('x-app-code')).toBe(false)
    expect(request.headers.has('x-app-passport')).toBe(false)
  })

  it('keeps the path prefix of a relative Console base URL', async () => {
    mockRequests({
      systemFeatures: () => Response.json({ ...features, console_web_url: '/dify' }),
    })
    const screen = await renderSidebar()

    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', '/dify/create-workspace')
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', '/my-account')
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
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', '/my-account')
    featuresRequest.resolve(Response.json(features))
    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/')
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', '/my-account')
  })

  it('keeps the workspace entry available with email and social sign-in disabled', async () => {
    mockRequests({
      account: () => Response.json({ ...profile, has_tenant: true }),
      systemFeatures: () =>
        Response.json({
          ...features,
          enable_email_code_login: false,
          enable_email_password_login: false,
          enable_social_oauth_login: false,
        }),
    })
    const screen = await renderSidebar()

    await expect
      .element(screen.getByRole('link', { name: buildAppLabel }))
      .toHaveAttribute('href', 'https://console.example.com/dify/')
  })

  it.each([
    { hasTenant: true, destination: '/' },
    { hasTenant: false, destination: '/create-workspace' },
  ])(
    'uses $destination for an empty same-origin Console prefix',
    async ({ hasTenant, destination }) => {
      mockRequests({
        account: () => Response.json({ ...profile, has_tenant: hasTenant }),
        systemFeatures: () => Response.json({ ...features, console_web_url: '' }),
      })
      const screen = await renderSidebar()

      await expect
        .element(screen.getByRole('link', { name: buildAppLabel }))
        .toHaveAttribute('href', destination)
    },
  )

  it('hides the workspace entry when Console discovery fails', async () => {
    mockRequests({
      account: () => Response.json({ ...profile, has_tenant: true }),
      systemFeatures: () => Response.json({ message: 'Features unavailable.' }, { status: 503 }),
    })
    const screen = await renderSidebar()

    await expect.element(screen.getByText(profile.name)).toBeVisible()
    await expect.element(screen.getByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: accountLabel }))
      .toHaveAttribute('href', '/my-account')
  })

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
