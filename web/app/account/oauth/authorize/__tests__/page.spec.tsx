import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createHttpError } from '@/service/http-error'
import { seedSystemFeatures } from '@/test/console/query-data'
import OAuthAuthorize from '../page'

const mocks = vi.hoisted(() => ({
  profileLoggedIn: true,
  logoutError: false,
  replaceDocument: vi.fn(),
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
  request: async (url: string, ...args: unknown[]) => {
    if (url.endsWith('/account/profile')) {
      if (!mocks.profileLoggedIn) throw createHttpError(new Response(null, { status: 401 }))
      return jsonResponse({
        avatar_url: null,
        email: 'user@example.com',
        name: 'Test User',
      })
    }
    return mocks.request(url, ...args)
  },
  post: vi.fn(),
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
    if (url.endsWith('/logout')) {
      if (mocks.logoutError) throw new Error('Logout failed')
      return jsonResponse({ result: 'success' })
    }
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
    mocks.logoutError = false
    mocks.searchParams = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback',
      state: 'state-1',
    })
    mockProviderResponses({ autoAuthorize: false })
    vi.stubGlobal('location', {
      href: 'https://dify.test/account/oauth/authorize',
      origin: 'https://dify.test',
      replace: mocks.replaceDocument,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('replaces the document when switching accounts and preserves the authorize URL', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'oauth.switchAccount' }))
    await waitFor(() =>
      expect(mocks.replaceDocument).toHaveBeenCalledExactlyOnceWith(
        `/signin?redirect_url=${encodeURIComponent(`https://dify.test/account/oauth/authorize?${mocks.searchParams.toString()}`)}`,
      ),
    )
    expect(findRequest('/logout')).toBeDefined()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('stays on the authorization page if switching accounts cannot log out', async () => {
    const user = userEvent.setup()
    mocks.logoutError = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'oauth.switchAccount' }))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(mocks.replaceDocument).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('authorizes the displayed app and redirects with the returned code and state', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('button', { name: /continue/i })
    expect(document.title).toBe('oauth.connect Test OAuth App - Dify')
    const providerRequest = findRequest('/oauth/provider')
    const providerTransportRequest = providerRequest?.[2]?.request as Request
    await expect(providerTransportRequest.clone().json()).resolves.toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback',
    })

    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
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

    await screen.findByRole('button', { name: /continue/i })
    const providerRequest = findRequest('/oauth/provider')
    const providerTransportRequest = providerRequest?.[2]?.request as Request
    await expect(providerTransportRequest.clone().json()).resolves.toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback?next=%2Fplugins',
    })
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

  it('still returns to marketplace after a new-user registration with utm_source', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
      oauth_new_user: 'true',
      utm_source: 'dify_marketplace',
    })
    mockProviderResponses({ autoAuthorize: true })

    renderPage()

    await waitFor(() =>
      expect(globalThis.location.href).toBe(
        'https://api.marketplace.example.com/api/v1/auth/callback/dify?code=oauth-code&state=marketplace-state',
      ),
    )
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

  it('keeps marketplace utm_source on the signin return URL', async () => {
    mocks.profileLoggedIn = false
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
      redirect_uri: 'https://api.marketplace.example.com/api/v1/auth/callback/dify',
      response_type: 'code',
      state: 'marketplace-state',
      utm_source: 'dify_marketplace',
    })
    mockProviderResponses({ autoAuthorize: true })

    renderPage()

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        `/signin?redirect_url=${encodeURIComponent(
          'https://dify.test/account/oauth/authorize?client_id=marketplace-client&redirect_uri=https%3A%2F%2Fapi.marketplace.example.com%2Fapi%2Fv1%2Fauth%2Fcallback%2Fdify&response_type=code&state=marketplace-state&utm_source=dify_marketplace',
        )}`,
      ),
    )
  })

  it('does not auto-authorize with incomplete OAuth parameters', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'marketplace-client',
    })
    mockProviderResponses({ autoAuthorize: true })

    renderPage()

    expect(await screen.findByText('oauth.error.invalidParams')).toBeInTheDocument()
    expect(findRequest('/oauth/provider')).toBeUndefined()
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
  })

  it('retries app info loading and resumes auto-authorization', async () => {
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
          auto_authorize: true,
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

describe('OAuthAuthorize OpenAPI client lookup', () => {
  const openApiParams = {
    client_id: 'openapi-client',
    redirect_uri: 'http://127.0.0.1:8123/callback',
    code_challenge: 'challenge-1',
    code_challenge_method: 'S256',
    resource: 'https://dify.test/openapi/v1',
    state: 'state-1',
  }
  const clientView = {
    client_id: 'openapi-client',
    display_name: 'Local CLI',
    logo_uri: null,
    redirect_host: '127.0.0.1',
    localhost_only: true,
  }
  const fetchMock = vi.fn()

  function stubLookup(status: number, body: unknown) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/openapi/v1/oauth/authorize/client')) {
        return new Response(JSON.stringify(body), { status })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.profileLoggedIn = true
    mocks.searchParams = new URLSearchParams(openApiParams)
    mockProviderResponses({ autoAuthorize: true })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('location', {
      href: 'https://dify.test/account/oauth/authorize',
      origin: 'https://dify.test',
      replace: mocks.replaceDocument,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not look up a request without PKCE', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://client.example.com/callback',
    })
    mockProviderResponses({ autoAuthorize: false })
    renderPage()

    expect(await screen.findByRole('button', { name: /continue/i })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the OpenAPI consent and never auto-authorizes', async () => {
    stubLookup(200, clientView)
    renderPage()

    expect(await screen.findByText('Local CLI')).toBeInTheDocument()
    expect(screen.getByText(/127\.0\.0\.1/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('oauth.openapi.localhostWarning')
    expect(findRequest('/oauth/provider')).toBeUndefined()
    expect(findRequest('/oauth/provider/authorize')).toBeUndefined()
    const lookupUrl = String(fetchMock.mock.calls[0]![0])
    expect(new URL(lookupUrl, 'https://dify.test').searchParams.get('redirect_uri')).toBe(
      openApiParams.redirect_uri,
    )
  })

  it('still sends redirect_uri on the lookup when it is empty', async () => {
    mocks.searchParams = new URLSearchParams({
      client_id: 'openapi-client',
      code_challenge: 'challenge-1',
    })
    stubLookup(400, { error: 'invalid_redirect_uri' })
    renderPage()

    await screen.findByText('oauth.openapi.error.invalidRequest')
    const lookupUrl = new URL(String(fetchMock.mock.calls[0]![0]), 'https://dify.test')
    expect(lookupUrl.searchParams.get('redirect_uri')).toBe('')
  })

  it.each([
    ['unknown client', 400, { error: 'invalid_client' }],
    ['feature off', 404, { error: 'not_found' }],
    ['rate limited', 429, { error: 'rate_limited' }],
    ['server error', 500, {}],
  ])('falls through to the creators-platform flow on %s', async (_name, status, body) => {
    stubLookup(status, body)
    mockProviderResponses({ autoAuthorize: false })
    renderPage()

    expect(await screen.findByRole('button', { name: /continue/i })).toBeInTheDocument()
    expect(findRequest('/oauth/provider')).toBeDefined()
  })

  it('falls through to the creators-platform flow on a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))
    mockProviderResponses({ autoAuthorize: false })
    renderPage()

    expect(await screen.findByRole('button', { name: /continue/i })).toBeInTheDocument()
  })

  it.each(['invalid_redirect_uri', 'invalid_request'])(
    'shows the OpenAPI error view for %s and never navigates',
    async (code) => {
      stubLookup(400, { error: code })
      renderPage()

      expect(await screen.findByText('oauth.openapi.error.invalidRequest')).toBeInTheDocument()
      expect(findRequest('/oauth/provider')).toBeUndefined()
      expect(globalThis.location.href).toBe('https://dify.test/account/oauth/authorize')
      expect(mocks.push).not.toHaveBeenCalled()
      expect(mocks.replace).not.toHaveBeenCalled()
    },
  )

  it('keeps the PKCE parameters on the sign-in link when logged out', async () => {
    mocks.profileLoggedIn = false
    stubLookup(200, clientView)
    renderPage()

    const link = await screen.findByRole('link', { name: 'oauth.login' })
    const signIn = new URL(link.getAttribute('href')!, 'https://dify.test')
    const returnUrl = new URL(signIn.searchParams.get('redirect_url')!)
    expect(returnUrl.pathname).toBe('/account/oauth/authorize')
    for (const [key, value] of Object.entries(openApiParams))
      expect(returnUrl.searchParams.get(key)).toBe(value)
  })
})
