import type {
  ConsumerAppsResponse,
  ConsumerConnectionProvidersResponse,
  ConsumerConnectionsResponse,
  WebAccountProfileResponse,
  WebSystemFeatureResponse,
} from '@dify/contracts/api/web/types.gen'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PUBLIC_API_PREFIX } from '@/config'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import { refreshAccessTokenOrReLogin } from '@/service/refresh-token'
import {
  getWebAppAuthSessionSnapshot,
  setWebAppAccessToken,
  setWebAppPassport,
  startWebAppAccountSession,
} from '@/service/webapp-auth'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { webAppClient, webAppQuery } from '../index'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

const deployment = vi.hoisted(() => ({ basePath: '' }))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return deployment.basePath
  },
}))

const appId = '11111111-1111-4111-8111-111111111111'
const connectionKey = '22222222-2222-4222-8222-222222222222'
const apps: ConsumerAppsResponse = {
  data: [
    {
      id: appId,
      app_code: 'shared-code',
      name: 'Research assistant',
      description: 'Research repositories',
      mode: 'advanced-chat',
      icon: null,
      icon_background: null,
      icon_type: null,
      is_favorite: false,
      last_used_at: null,
    },
  ],
  has_more: false,
  next_cursor: null,
}
const connections: ConsumerConnectionsResponse = {
  data: [
    {
      key: connectionKey,
      provider: 'langgenius/github/github',
      name: 'Personal GitHub',
      account_label: 'joel@example.com',
      connection_type: 'oauth2',
      webapps_count: 1,
    },
  ],
  has_more: false,
  next_cursor: null,
}
const providers: ConsumerConnectionProvidersResponse = {
  data: [
    {
      provider: 'langgenius/github/github',
      label: { en_US: 'GitHub' },
      description: { en_US: 'Access your repositories' },
      icon: null,
      icon_dark: null,
      connections_count: 1,
    },
  ],
  has_more: false,
  next_cursor: null,
}

const accountProfile: WebAccountProfileResponse = {
  name: 'Joel',
  email: 'joel@example.com',
  avatar: null,
  avatar_url: null,
  is_password_set: true,
  interface_language: 'en-US',
  interface_theme: 'light',
  timezone: 'UTC',
}

const systemFeatures = {
  ...createSystemFeaturesFixture(),
  account_login_url: 'https://accounts.example/console/signin?source=portal',
} satisfies WebSystemFeatureResponse

function expectAccountRequest(
  input: RequestInfo | URL,
  options: RequestInit | undefined,
  path: string,
  method: string,
) {
  const request = new Request(input, options)
  expect(request.url).toBe(new URL(`${PUBLIC_API_PREFIX}${path}`, window.location.origin).href)
  expect(request.method).toBe(method)
  expect(request.credentials).toBe('include')
  expect(request.headers.has('Authorization')).toBe(false)
  expect(request.headers.has('X-App-Code')).toBe(false)
  expect(request.headers.has('X-App-Passport')).toBe(false)
}

describe('generated account Web App client', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    deployment.basePath = ''
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/my-apps')
    captureAppAccessScope()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })

  it('loads My apps with the account cookie without an active Web App or App Passport', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(apps))

    await expect(webAppClient.me.apps.get()).resolves.toEqual(apps)

    expect(fetch).toHaveBeenCalledOnce()
    expectAccountRequest(...fetch.mock.calls[0]!, '/me/apps', 'GET')
  })

  it('loads the account profile using only the account cookie outside an App route', async () => {
    setWebAppAccessToken('old-account-bearer', 'end_user')
    setWebAppPassport({ kind: 'default', code: 'previous-app' }, 'old-app-passport')
    const profile = { name: 'Joel', avatar: null, avatar_url: 'https://example.com/joel.png' }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(profile))

    await expect(webAppClient.account.profile.get()).resolves.toEqual(profile)

    expect(fetch).toHaveBeenCalledOnce()
    expectAccountRequest(...fetch.mock.calls[0]!, '/account/profile', 'GET')
  })

  it.each([
    {
      path: '/account/profile',
      method: 'PATCH',
      body: { name: 'Updated name' },
      save: () => webAppClient.account.profile.patch({ body: { name: 'Updated name' } }),
    },
    {
      path: '/account/password',
      method: 'POST',
      body: {
        password: 'old-password',
        new_password: 'new-password',
        repeat_new_password: 'new-password',
      },
      save: () =>
        webAppClient.account.password.post({
          body: {
            password: 'old-password',
            new_password: 'new-password',
            repeat_new_password: 'new-password',
          },
        }),
    },
  ])(
    'saves $path with the account cookie and JSON body without App credentials',
    async ({ path, method, body, save }) => {
      window.history.replaceState({}, '', '/my-account')
      setWebAppAccessToken('unused-account-bearer', 'end_user')
      setWebAppPassport({ kind: 'default', code: 'previous-app' }, 'unused-passport')
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json(accountProfile))

      await expect(save()).resolves.toEqual(accountProfile)

      expect(fetch).toHaveBeenCalledOnce()
      expectAccountRequest(...fetch.mock.calls[0]!, path, method)
      expect(await new Request(...fetch.mock.calls[0]!).json()).toEqual(body)
    },
  )

  it.each([
    { label: 'apps', request: () => webAppClient.me.apps.get() },
    { label: 'profile', request: () => webAppClient.account.profile.get() },
    {
      label: 'favorite',
      request: () => webAppClient.me.apps.byAppId.favorite.put({ params: { app_id: appId } }),
    },
  ])('redirects unauthorized $label to personal sign-in', async ({ request }) => {
    window.history.replaceState({}, '', '/my-apps?view=starred&q=hello%20world#apps')
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(
          { code: 'unauthorized', message: 'Authentication required.', status: 401 },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(Response.json(systemFeatures))

    await expect(request()).rejects.toMatchObject({ status: 401 })

    expect(fetch).toHaveBeenCalledTimes(2)
    expectAccountRequest(...fetch.mock.calls[1]!, '/system-features', 'GET')
    expect(refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledOnce()
    const signin = new URL(replace.mock.calls[0]![0])
    expect(signin.origin).toBe('https://accounts.example')
    expect(signin.pathname).toBe('/console/signin')
    expect(signin.searchParams.get('source')).toBe('portal')
    expect(signin.searchParams.get('is_end_user')).toBe('1')
    expect(signin.searchParams.get('redirect_url')).toBe(
      '/console/my-apps?view=starred&q=hello%20world#apps',
    )
    expect(signin.searchParams.has('app_code')).toBe(false)
    expect(signin.searchParams.has('code_challenge')).toBe(false)
  })

  it.each([403, 500])('does not redirect account errors with status %s', async (status) => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status }))
    await expect(webAppClient.me.apps.get()).rejects.toMatchObject({ status })
    expect(replace).not.toHaveBeenCalled()
  })

  it('uses the Console sign-in prefix instead of the local Web app prefix', async () => {
    deployment.basePath = '/console'
    window.history.replaceState({}, '', '/console/my-apps/?view=starred#apps')
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          ...systemFeatures,
          account_login_url: 'https://accounts.example/portal/signin',
        }),
      )
    await expect(webAppClient.me.apps.get()).rejects.toMatchObject({ status: 401 })
    const signin = new URL(replace.mock.calls[0]![0])
    expect(signin.origin).toBe('https://accounts.example')
    expect(signin.pathname).toBe('/portal/signin')
    expect(signin.searchParams.get('redirect_url')).toBe('/portal/my-apps?view=starred#apps')
    expect(signin.searchParams.get('is_end_user')).toBe('1')
    expectAccountRequest(...fetch.mock.calls[1]!, '/system-features', 'GET')
  })

  it.each(['/signin', '/chat/shared-code'])(
    'does not redirect account 401s on %s',
    async (pathname) => {
      window.history.replaceState({}, '', pathname)
      captureAppAccessScope()
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }))
      await expect(webAppClient.account.profile.get()).rejects.toMatchObject({ status: 401 })
      expect(replace).not.toHaveBeenCalled()
    },
  )

  it('does not redirect a stale unauthorized response after an account switch', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    let finish!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
    )
    const result = webAppClient.me.apps.get().catch((error: unknown) => error)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    startWebAppAccountSession()
    finish(new Response(null, { status: 401 }))
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
  })

  it('loads public sign-in configuration without an App or leaking stored credentials', async () => {
    setWebAppAccessToken('old-account-bearer', 'end_user')
    setWebAppPassport({ kind: 'default', code: 'previous-app' }, 'old-app-passport')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(systemFeatures))

    await expect(webAppClient.systemFeatures.get()).resolves.toEqual(systemFeatures)

    expectAccountRequest(...fetch.mock.calls[0]!, '/system-features', 'GET')
  })

  it.each([null, 'javascript:alert(1)', 'https://[invalid/signin'])(
    'does not redirect when the configured login URL is %s',
    async (account_login_url) => {
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(Response.json({ ...systemFeatures, account_login_url }))

      await expect(webAppClient.me.apps.get()).rejects.toMatchObject({ status: 401 })

      expect(replace).not.toHaveBeenCalled()
    },
  )

  it('accepts the relative sign-in URL returned when no Console URL is configured', async () => {
    window.history.replaceState({}, '', '/my-apps?view=starred#apps')
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ...systemFeatures, account_login_url: '/signin' }))

    await expect(webAppClient.me.apps.get()).rejects.toMatchObject({ status: 401 })

    expect(replace).toHaveBeenCalledOnce()
    const signin = new URL(replace.mock.calls[0]![0])
    expect(signin.origin).toBe(window.location.origin)
    expect(signin.pathname).toBe('/signin')
    expect(signin.searchParams.get('is_end_user')).toBe('1')
    expect(signin.searchParams.get('redirect_url')).toBe('/my-apps?view=starred#apps')
    expect(signin.searchParams.has('app_code')).toBe(false)
    expect(signin.searchParams.has('code_challenge')).toBe(false)
  })

  it.each(['network', 'server'] as const)(
    'preserves the original unauthorized error without redirecting after a bootstrap %s failure',
    async (failure) => {
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          Response.json(
            { code: 'unauthorized', message: 'Account session expired.', status: 401 },
            { status: 401 },
          ),
        )
      if (failure === 'network') fetch.mockRejectedValueOnce(new TypeError('Network unavailable'))
      else
        fetch.mockResolvedValueOnce(
          Response.json(
            { code: 'internal_server_error', message: 'Bootstrap unavailable.', status: 500 },
            { status: 500 },
          ),
        )

      await expect(webAppClient.me.apps.get()).rejects.toMatchObject({
        status: 401,
        message: 'Account session expired.',
      })

      expect(fetch).toHaveBeenCalledTimes(2)
      expectAccountRequest(...fetch.mock.calls[1]!, '/system-features', 'GET')
      expect(replace).not.toHaveBeenCalled()
    },
  )

  it.each(['account change', 'leaving My apps'] as const)(
    'ignores pending sign-in configuration after %s',
    async (change) => {
      const configuration = createDeferred<Response>()
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockReturnValueOnce(configuration.promise)
      const result = webAppClient.me.apps.get().catch((error: unknown) => error)
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      expect(replace).not.toHaveBeenCalled()

      if (change === 'account change') startWebAppAccountSession()
      else window.history.replaceState({}, '', '/connections')
      configuration.resolve(Response.json(systemFeatures))

      expect(await result).toMatchObject({ name: 'AbortError' })
      expect(replace).not.toHaveBeenCalled()
    },
  )

  it('loads My connections without leaking stored credentials from a previously visited App', async () => {
    window.history.replaceState({}, '', '/connections')
    setWebAppAccessToken('old-account-bearer', 'end_user')
    setWebAppPassport({ kind: 'default', code: 'previous-app' }, 'old-app-passport')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(providers))

    await expect(webAppClient.me.connections.get()).resolves.toEqual(providers)

    expectAccountRequest(...fetch.mock.calls[0]!, '/me/connections', 'GET')
  })

  it('loads a provider connection page with the full provider path and cookie-only authentication', async () => {
    window.history.replaceState({}, '', '/connections')
    setWebAppPassport({ kind: 'default', code: 'previous-app' }, 'old-app-passport')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(connections))
    await expect(
      webAppClient.me.connections.providers.byProvider.connections.get({
        params: { provider: 'langgenius/github/github' },
        query: { cursor: connectionKey, limit: 100 },
      }),
    ).resolves.toEqual(connections)
    expectAccountRequest(
      ...fetch.mock.calls[0]!,
      `/me/connections/providers/langgenius%2Fgithub%2Fgithub/connections?cursor=${connectionKey}&limit=100`,
      'GET',
    )
  })

  it.each(['favorite', 'unfavorite', 'remove', 'disconnect'] as const)(
    '%s uses a cookie-only account mutation and invalidates the affected account lists',
    async (action) => {
      window.history.replaceState({}, '', '/connections')
      setWebAppAccessToken('old-account-bearer', 'end_user')
      setWebAppPassport({ kind: 'default', code: 'previous-app' }, 'old-app-passport')
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
      const appsKey = webAppQuery.me.apps.get.queryKey()
      const connectionsKey = webAppQuery.me.connections.get.queryKey()
      const providerConnectionsKey =
        webAppQuery.me.connections.providers.byProvider.connections.get.queryKey({
          input: { params: { provider: 'langgenius/github/github' } },
        })
      const linkedAppsKey = webAppQuery.me.connections.byConnectionKey.apps.get.queryKey({
        input: { params: { connection_key: connectionKey } },
      })
      const otherKey = webAppQuery.login.status.get.queryKey()
      queryClient.setQueryData(appsKey, apps)
      queryClient.setQueryData(connectionsKey, providers)
      queryClient.setQueryData(providerConnectionsKey, connections)
      queryClient.setQueryData(linkedAppsKey, apps)
      queryClient.setQueryData(otherKey, { logged_in: true, app_logged_in: false })

      if (action === 'favorite') {
        await new MutationObserver(
          queryClient,
          webAppQuery.me.apps.byAppId.favorite.put.mutationOptions(),
        ).mutate({ params: { app_id: appId } })
      } else if (action === 'unfavorite') {
        await new MutationObserver(
          queryClient,
          webAppQuery.me.apps.byAppId.favorite.delete.mutationOptions(),
        ).mutate({ params: { app_id: appId } })
      } else if (action === 'remove') {
        await new MutationObserver(
          queryClient,
          webAppQuery.me.apps.byAppId.delete.mutationOptions(),
        ).mutate({ params: { app_id: appId } })
      } else {
        await new MutationObserver(
          queryClient,
          webAppQuery.me.connections.byConnectionKey.delete.mutationOptions(),
        ).mutate({ params: { connection_key: connectionKey } })
      }

      expect(fetch).toHaveBeenCalledOnce()
      expectAccountRequest(
        ...fetch.mock.calls[0]!,
        action === 'disconnect'
          ? `/me/connections/${connectionKey}`
          : action === 'remove'
            ? `/me/apps/${appId}`
            : `/me/apps/${appId}/favorite`,
        action === 'favorite' ? 'PUT' : 'DELETE',
      )
      expect(queryClient.getQueryState(appsKey)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(connectionsKey)?.isInvalidated).toBe(action === 'disconnect')
      expect(queryClient.getQueryState(providerConnectionsKey)?.isInvalidated).toBe(
        action === 'disconnect',
      )
      expect(queryClient.getQueryState(linkedAppsKey)?.isInvalidated).toBe(action === 'disconnect')
      expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false)
    },
  )

  it('does not send a query captured before the signed-in account changes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const authSession = getWebAppAuthSessionSnapshot()
    const options = webAppQuery.me.apps.get.queryOptions({
      context: { authSession },
      queryKey: [...webAppQuery.me.apps.get.queryKey(), authSession],
    })
    startWebAppAccountSession()

    await expect(queryClient.query(options)).rejects.toMatchObject({ name: 'AbortError' })

    expect(fetch).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined()
  })

  it('discards a previous account response instead of caching it after an account switch', async () => {
    let resolve!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done
      }),
    )
    const authSession = getWebAppAuthSessionSnapshot()
    const options = webAppQuery.me.connections.get.queryOptions({
      context: { authSession },
      queryKey: [...webAppQuery.me.connections.get.queryKey(), authSession],
    })
    const result = queryClient.query(options).catch((error: unknown) => error)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    startWebAppAccountSession()
    resolve(Response.json(providers))

    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined()
  })
})
