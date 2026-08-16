import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { seedSystemFeatures } from '@/test/console/query-data'
import OAuthAuthorize from '../page'

const mocks = vi.hoisted(() => ({
  profileLoggedIn: true,
  push: vi.fn(),
  replace: vi.fn(),
  request: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock('@/service/base', () => ({
  get: vi.fn(async () => {
    if (!mocks.profileLoggedIn) throw new Response(null, { status: 401 })
    return new Response(
      JSON.stringify({
        avatar_url: null,
        email: 'user@example.com',
        name: 'Test User',
      }),
      { status: 200 },
    )
  }),
  post: vi.fn(),
  request: (...args: unknown[]) => mocks.request(...args),
  sseGeneratorPost: vi.fn(),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  seedSystemFeatures(queryClient)

  return render(
    <QueryClientProvider client={queryClient}>
      <OAuthAuthorize />
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function findRequest(path: string) {
  return mocks.request.mock.calls.find(([url]) => String(url).endsWith(path))
}

function mockProviderResponses({ autoAuthorize }: { autoAuthorize: boolean }) {
  mocks.request.mockImplementation(async (url: string) => {
    if (url.endsWith('/oauth/provider/authorize')) return jsonResponse({ code: 'oauth-code' })
    if (url.endsWith('/oauth/provider')) {
      return jsonResponse({
        app_icon: '',
        app_label: { en_US: 'Test OAuth App' },
        auto_authorize: autoAuthorize,
        scope: '',
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

function countRequests(path: string) {
  return mocks.request.mock.calls.filter(([url]) => String(url).endsWith(path)).length
}

describe('OAuthAuthorize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.profileLoggedIn = true
    mocks.searchParams = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback',
      state: 'state-1',
    })
    mockProviderResponses({ autoAuthorize: false })
    vi.stubGlobal('location', {
      href: 'https://dify.test/account/oauth/authorize',
      origin: 'https://dify.test',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('authorizes the displayed app and redirects with the returned code and state', async () => {
    const user = userEvent.setup()
    renderPage()

    expect((await screen.findAllByText('Test OAuth App')).length).toBeGreaterThan(0)
    expect(document.title).toBe('oauth.connect Test OAuth App - Dify')
    const providerRequest = findRequest('/oauth/provider')
    const providerTransportRequest = providerRequest?.[2]?.request as Request
    await expect(providerTransportRequest.clone().json()).resolves.toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback',
    })

    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(findRequest('/oauth/provider/authorize')).toBeDefined())
    const authorizeRequest = findRequest('/oauth/provider/authorize')
    const transportRequest = authorizeRequest?.[2]?.request as Request
    await expect(transportRequest.clone().json()).resolves.toEqual({ client_id: 'client-1' })
    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://client.example.com/callback?code=oauth-code&state=state-1',
      ),
    )
  })

  it('silently authorizes an app flagged with auto_authorize without rendering consent', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })
    mockProviderResponses({ autoAuthorize: true })

    renderPage()

    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://api.marketplace.example.com/api/v1/auth/callback/dify?code=oauth-code&state=marketplace-state',
      ),
    )
    expect(countRequests('/oauth/provider/authorize')).toBe(1)
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument()
  })

  it('keeps the consent flow when the app is not flagged with auto_authorize', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: /continue/i })).toBeInTheDocument()
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('sends an anonymous user of an auto_authorize app to signin with the full authorize URL', async () => {
    mocks.profileLoggedIn = false
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })
    mockProviderResponses({ autoAuthorize: true })

    renderPage()

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        `/signin?redirect_url=${encodeURIComponent(
          'https://dify.test/account/oauth/authorize?client_id=marketplace-client&redirect_uri=https%3A%2F%2Fapi.marketplace.example.com%2Fapi%2Fv1%2Fauth%2Fcallback%2Fdify&response_type=code&state=marketplace-state',
        )}`,
      ),
    )
    expect(findRequest('/oauth/provider')).toBeDefined()
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('falls back to manual confirmation when silent authorization fails', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })
    let authorizeAttempts = 0
    mocks.request.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/provider/authorize')) {
        authorizeAttempts += 1
        if (authorizeAttempts === 1) throw new Error('Automatic authorization failed')
        return jsonResponse({ code: 'oauth-code' })
      }
      if (url.endsWith('/oauth/provider')) {
        return jsonResponse({
          app_icon: '',
          app_label: { en_US: 'Test OAuth App' },
          auto_authorize: true,
          scope: '',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const user = userEvent.setup()
    renderPage()

    const continueButton = await screen.findByRole('button', { name: /continue/i })
    await user.click(continueButton)

    await waitFor(() => expect(authorizeAttempts).toBe(2))
    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://api.marketplace.example.com/api/v1/auth/callback/dify?code=oauth-code&state=marketplace-state',
      ),
    )
  })
})
