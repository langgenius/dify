import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedSystemFeatures } from '@/test/console/query-data'
import OAuthAuthorize from '../page'

const mocks = vi.hoisted(() => ({
  deploymentEdition: 'CLOUD' as 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE',
  marketplaceOAuthClientId: 'marketplace-client',
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
    get MARKETPLACE_OAUTH_CLIENT_ID() {
      return mocks.marketplaceOAuthClientId
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
  seedSystemFeatures(queryClient, {
    deployment_edition: mocks.deploymentEdition,
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
    mocks.deploymentEdition = 'CLOUD'
    mocks.marketplaceOAuthClientId = 'marketplace-client'
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

  it('preserves an encoded redirect URI when requesting the OAuth app', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback?next=%2Fplugins',
      state: 'state-1',
    })

    renderPage()

    expect((await screen.findAllByText('Test OAuth App')).length).toBeGreaterThan(0)
    const providerRequest = findRequest('/oauth/provider')
    const providerTransportRequest = providerRequest?.[2]?.request as Request
    await expect(providerTransportRequest.clone().json()).resolves.toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback?next=%2Fplugins',
    })
  })

  it('silently authorizes the configured Marketplace client when the Dify user is logged in', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })

    renderPage()

    await waitFor(() => expect(findRequest('/oauth/provider/authorize')).toBeDefined())
    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://api.marketplace.example.com/api/v1/auth/callback/dify?code=oauth-code&state=marketplace-state',
      ),
    )
  })

  it('keeps the normal confirmation flow outside Cloud', async () => {
    mocks.deploymentEdition = 'COMMUNITY'
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })

    renderPage()

    expect((await screen.findAllByText('Test OAuth App')).length).toBeGreaterThan(0)
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('keeps the normal confirmation flow when the Marketplace client id is unset', async () => {
    mocks.marketplaceOAuthClientId = ''
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })

    renderPage()

    expect((await screen.findAllByText('Test OAuth App')).length).toBeGreaterThan(0)
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('keeps the normal confirmation flow for a different OAuth client', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback',
      response_type: 'code',
      state: 'state-1',
    })

    renderPage()

    expect((await screen.findAllByText('Test OAuth App')).length).toBeGreaterThan(0)
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('sends an anonymous Marketplace client through Dify signin with the full authorize URL', async () => {
    mocks.profileLoggedIn = false
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })

    renderPage()

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        `/signin?redirect_url=${encodeURIComponent(
          'https://dify.test/account/oauth/authorize?client_id=marketplace-client&redirect_uri=https%3A%2F%2Fapi.marketplace.example.com%2Fapi%2Fv1%2Fauth%2Fcallback%2Fdify&response_type=code&state=marketplace-state',
        )}`,
      ),
    )
    expect(findRequest('/oauth/provider')).toBeUndefined()
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('does not auto-authorize a Marketplace client with incomplete OAuth parameters', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
    })

    renderPage()

    expect(await screen.findByText('oauth.error.invalidParams')).toBeInTheDocument()
    expect(findRequest('/oauth/provider')).toBeUndefined()
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('retries Marketplace app info loading and resumes auto-authorization', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
    })
    let providerAttempts = 0
    mocks.request.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/provider/authorize')) return jsonResponse({ code: 'oauth-code' })
      if (url.endsWith('/oauth/provider')) {
        providerAttempts += 1
        if (providerAttempts === 1) throw new Error('Failed to load OAuth app')
        return jsonResponse({
          app_icon: '',
          app_label: { en_US: 'Test OAuth App' },
          scope: '',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('oauth.error.authAppInfoFetchFailed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(findRequest('/oauth/provider/authorize')).toBeDefined())
    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://api.marketplace.example.com/api/v1/auth/callback/dify?code=oauth-code&state=marketplace-state',
      ),
    )
  })

  it('falls back to manual confirmation when Marketplace auto-authorization fails', async () => {
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

  it('renders an unknown OAuth scope without crashing', async () => {
    mocks.request.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/provider')) {
        return jsonResponse({
          app_icon: '',
          app_label: { en_US: 'Test OAuth App' },
          scope: 'read:custom_profile',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPage()

    expect(await screen.findByText('read:custom_profile')).toBeInTheDocument()
  })

  it('supports OAuth app labels that use a hyphenated locale key', async () => {
    mocks.request.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/provider')) {
        return jsonResponse({
          app_icon: '',
          app_label: { 'en-US': 'Hyphenated OAuth App' },
          scope: '',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    renderPage()

    expect((await screen.findAllByText('Hyphenated OAuth App')).length).toBeGreaterThan(0)
  })
})
