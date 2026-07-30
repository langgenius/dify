import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OAuthAuthorize from '../page'

const mocks = vi.hoisted(() => ({
  isCloudEdition: true,
  marketplaceOAuthClientId: 'marketplace-client',
  marketplaceUrlPrefix: 'https://marketplace.example.com',
  parent: null as null | { postMessage: ReturnType<typeof vi.fn> },
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

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get IS_CLOUD_EDITION() {
      return mocks.isCloudEdition
    },
    get MARKETPLACE_OAUTH_CLIENT_ID() {
      return mocks.marketplaceOAuthClientId
    },
    get MARKETPLACE_URL_PREFIX() {
      return mocks.marketplaceUrlPrefix
    },
  }
})

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

describe('OAuthAuthorize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isCloudEdition = true
    mocks.marketplaceOAuthClientId = 'marketplace-client'
    mocks.marketplaceUrlPrefix = 'https://marketplace.example.com'
    mocks.parent = null
    mocks.profileLoggedIn = true
    mocks.searchParams = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback',
      state: 'state-1',
    })
    mocks.request.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/provider/authorize')) return jsonResponse({ code: 'oauth-code' })
      if (url.endsWith('/oauth/provider')) {
        return jsonResponse({
          app_icon: '',
          app_label: { en_US: 'Test OAuth App' },
          scope: '',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('location', {
      href: 'https://dify.test/account/oauth/authorize',
      origin: 'https://dify.test',
    })
    vi.stubGlobal('parent', globalThis)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('authorizes the displayed app and redirects with the returned code and state', async () => {
    const user = userEvent.setup()
    renderPage()

    expect((await screen.findAllByText('Test OAuth App')).length).toBeGreaterThan(0)
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

  it('silently authorizes the configured Marketplace client when the Dify user is logged in', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
      flow: 'marketplace',
    })

    renderPage()

    await waitFor(() => expect(findRequest('/oauth/provider/authorize')).toBeDefined())
    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://api.marketplace.example.com/api/v1/auth/callback/dify?code=oauth-code&state=marketplace-state',
      ),
    )
  })

  it('notifies the Marketplace parent when a framed Dify user is anonymous', async () => {
    mocks.profileLoggedIn = false
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      flow: 'marketplace',
    })
    mocks.parent = { postMessage: vi.fn() }
    vi.stubGlobal('parent', mocks.parent)

    renderPage()

    await waitFor(() =>
      expect(mocks.parent?.postMessage).toHaveBeenCalledWith(
        {
          type: 'dify-marketplace-oauth-status',
          status: 'anonymous',
        },
        'https://marketplace.example.com',
      ),
    )
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('sends an anonymous top-level Marketplace flow through Dify signin with the full authorize URL', async () => {
    mocks.profileLoggedIn = false
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
      flow: 'marketplace',
    })

    renderPage()

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        `/signin?redirect_url=${encodeURIComponent(
          'https://dify.test/account/oauth/authorize?client_id=marketplace-client&redirect_uri=https%3A%2F%2Fapi.marketplace.example.com%2Fapi%2Fv1%2Fauth%2Fcallback%2Fdify&response_type=code&state=marketplace-state&flow=marketplace',
        )}`,
      ),
    )
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })
})
