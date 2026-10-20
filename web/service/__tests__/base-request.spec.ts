import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  discardRegistrationSessionState,
  OAUTH_REGISTRATION_GA_SENT_KEY,
  REGISTRATION_SUCCESS_STORAGE_KEY,
} from '@/app/components/base/amplitude/registration-session-state'
// oxlint-disable-next-line no-restricted-imports -- This spec directly tests the legacy request owner.
import { request, ssePost, upload } from '../base'

const mocks = vi.hoisted(() => ({
  isClient: true,
  baseFetch: vi.fn(),
  beginWebAppAuthorizationRecovery: vi.fn(),
  clearWebAppPassport: vi.fn(),
  completeWebAppAuthorizationRecovery: vi.fn(),
  refreshAccessTokenOrReLogin: vi.fn(),
  resolveWebAppAddress: vi.fn(),
}))

vi.mock('@/utils/client', () => ({
  get isClient() {
    return mocks.isClient
  },
  get isServer() {
    return !mocks.isClient
  },
}))

vi.mock('@/utils/var', () => ({
  basePath: '/app',
}))

vi.mock('../refresh-token', () => ({
  refreshAccessTokenOrReLogin: mocks.refreshAccessTokenOrReLogin,
}))

vi.mock('../webapp-address', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../webapp-address')>()),
  getWebAppPublicApiPath: (_address: unknown, path: string) => path,
  resolveWebAppAddress: mocks.resolveWebAppAddress,
}))

vi.mock('../webapp-auth', () => ({
  beginWebAppAuthorizationRecovery: mocks.beginWebAppAuthorizationRecovery,
  clearWebAppPassport: mocks.clearWebAppPassport,
  completeWebAppAuthorizationRecovery: mocks.completeWebAppAuthorizationRecovery,
  getWebAppPassport: vi.fn(() => ''),
  getWebAppAccessToken: vi.fn(() => ''),
}))

const createUnauthorizedResponse = () =>
  new Response(
    JSON.stringify({
      code: 'unauthorized',
      message: 'Invalid Authorization token.',
      status: 401,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )

const createForcedLogoutResponse = () =>
  new Response(
    JSON.stringify({
      code: 'unauthorized_and_force_logout',
      message: 'This account session is no longer valid.',
      status: 401,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )

type ClientRequestOptions = {
  response: Response
  refreshError?: Error
}

function arrangeClientRequest({ response, refreshError }: ClientRequestOptions) {
  mocks.baseFetch.mockResolvedValue(response)
  if (refreshError) mocks.refreshAccessTokenOrReLogin.mockRejectedValue(refreshError)
}

describe('request 401 handling', () => {
  beforeEach(() => {
    mocks.isClient = true
    mocks.baseFetch.mockReset()
    vi.stubGlobal('fetch', mocks.baseFetch)
    mocks.beginWebAppAuthorizationRecovery.mockReset()
    mocks.beginWebAppAuthorizationRecovery.mockReturnValue(true)
    mocks.clearWebAppPassport.mockReset()
    mocks.completeWebAppAuthorizationRecovery.mockReset()
    mocks.refreshAccessTokenOrReLogin.mockReset()
    mocks.resolveWebAppAddress.mockReset()
    vi.stubGlobal('location', {
      origin: 'https://example.com',
      pathname: '/app/apps',
      search: '?category=agent',
      hash: '#recent',
      href: 'https://example.com/app/apps?category=agent#recent',
      reload: vi.fn(),
    })
    window.sessionStorage.clear()
  })

  afterEach(() => {
    discardRegistrationSessionState()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('should not run browser auth recovery when handling 401 on the server', async () => {
    const response = createUnauthorizedResponse()
    mocks.isClient = false
    mocks.baseFetch.mockResolvedValue(response)

    await expect(request('/account/profile')).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('should preserve the current URL when a 401 response cannot be parsed', async () => {
    const response = new Response('not-json', { status: 401 })
    arrangeClientRequest({ response })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'account-a-marker')

    await expect(request('/account/profile')).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(globalThis.location.href).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps?category=agent#recent')}`,
    )
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('clears account A registration state before a forced reload so account B starts clean', async () => {
    const response = createForcedLogoutResponse()
    arrangeClientRequest({ response })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'account-a-marker')
    window.sessionStorage.setItem(OAUTH_REGISTRATION_GA_SENT_KEY, 'true')
    const reload = vi.fn(() => {
      expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
      expect(window.sessionStorage.getItem(OAUTH_REGISTRATION_GA_SENT_KEY)).toBeNull()
    })
    globalThis.location.reload = reload

    await expect(request('/account/profile')).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(reload).toHaveBeenCalledOnce()
  })

  it('should preserve the current URL when token refresh fails', async () => {
    const response = createUnauthorizedResponse()
    arrangeClientRequest({
      response,
      refreshError: new Error('refresh failed'),
    })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'account-a-marker')

    await expect(request('/account/profile')).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(mocks.refreshAccessTokenOrReLogin).toHaveBeenCalledOnce()
    expect(globalThis.location.href).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps?category=agent#recent')}`,
    )
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
  })

  it('does not clear console registration state for a public-app 401 redirect', async () => {
    const response = createUnauthorizedResponse()
    arrangeClientRequest({ response })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'console-marker')

    await expect(request('/account/profile', {}, { isPublicAPI: true })).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('console-marker')
  })

  it('should reload an environment webapp after its passport becomes unauthorized', async () => {
    const address = { kind: 'environment', code: 'environment-code' } as const
    const response = new Response(
      JSON.stringify({
        code: 401,
        reason: 'APPDEPLOY_UNAUTHORIZED',
        message: 'Unauthorized',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
    mocks.resolveWebAppAddress.mockReturnValue(address)
    arrangeClientRequest({ response })

    await expect(request('/messages')).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(mocks.clearWebAppPassport).toHaveBeenCalledWith(address)
    expect(globalThis.location.reload).toHaveBeenCalledOnce()
    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('should complete authorization recovery after an environment request succeeds', async () => {
    const address = { kind: 'environment', code: 'environment-code' } as const
    mocks.resolveWebAppAddress.mockReturnValue(address)
    mocks.baseFetch.mockImplementation(async () => Response.json({ app_id: 'app-id' }))

    await request('/site', {}, { isPublicAPI: true })

    expect(mocks.completeWebAppAuthorizationRecovery).toHaveBeenCalledWith(address)
  })

  it('should keep authorization recovery pending after passport succeeds', async () => {
    const address = { kind: 'environment', code: 'environment-code' } as const
    mocks.resolveWebAppAddress.mockReturnValue(address)
    mocks.baseFetch.mockResolvedValue(Response.json({ access_token: 'passport' }))

    await request('/passport', {}, { isPublicAPI: true })

    expect(mocks.completeWebAppAuthorizationRecovery).not.toHaveBeenCalled()
  })

  it('should show forbidden when an environment SSE request is denied', async () => {
    const address = { kind: 'environment', code: 'environment-code' } as const
    mocks.resolveWebAppAddress.mockReturnValue(address)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 401,
          reason: 'APPDEPLOY_WEB_APP_ACCESS_DENIED',
          message: 'You do not have permission to access this web app.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    ssePost('/chat-messages', { body: { query: 'hello' } }, { isPublicAPI: true })

    await vi.waitFor(() => {
      expect(globalThis.location.href).toContain('/webapp-signin?')
      expect(globalThis.location.href).toContain('code=403')
    })
    expect(mocks.clearWebAppPassport).not.toHaveBeenCalled()
    expect(globalThis.location.reload).not.toHaveBeenCalled()
  })

  it('should stop reloading when environment authorization does not recover', async () => {
    const address = { kind: 'environment', code: 'environment-code' } as const
    const response = new Response(
      JSON.stringify({
        code: 401,
        reason: 'APPDEPLOY_UNAUTHORIZED',
        message: 'Unauthorized',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
    mocks.resolveWebAppAddress.mockReturnValue(address)
    mocks.beginWebAppAuthorizationRecovery.mockReturnValue(false)
    arrangeClientRequest({ response })

    await expect(request('/site')).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(mocks.clearWebAppPassport).not.toHaveBeenCalled()
    expect(globalThis.location.reload).not.toHaveBeenCalled()
    expect(globalThis.location.href).toContain('/webapp-signin?')
    expect(globalThis.location.href).toContain('message=Unauthorized')
  })

  it('should report a public SSE 403 that is not recoverable', async () => {
    const onError = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'web_app_disabled',
          message: 'webapp is disabled',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    ssePost('/chat-messages', { body: { query: 'hello' } }, { isPublicAPI: true, onError })

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('webapp is disabled', 'web_app_disabled')
    })
    expect(mocks.beginWebAppAuthorizationRecovery).not.toHaveBeenCalled()
  })

  it('should show forbidden when an environment request is denied', async () => {
    const address = { kind: 'environment', code: 'environment-code' } as const
    const response = new Response(
      JSON.stringify({
        code: 401,
        reason: 'APPDEPLOY_WEB_APP_ACCESS_DENIED',
        message: 'You do not have permission to access this web app.',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
    mocks.resolveWebAppAddress.mockReturnValue(address)
    arrangeClientRequest({ response })

    await expect(request('/messages', {}, { isPublicAPI: true })).rejects.toMatchObject({
      defined: false,
      status: response.status,
    })

    expect(globalThis.location.href).toContain('/webapp-signin?')
    expect(globalThis.location.href).toContain('code=403')
    expect(mocks.clearWebAppPassport).not.toHaveBeenCalled()
    expect(globalThis.location.reload).not.toHaveBeenCalled()
  })

  it('should show forbidden when an environment upload is denied', async () => {
    const address = { kind: 'environment', code: 'environment-code' } as const
    mocks.resolveWebAppAddress.mockReturnValue(address)
    const xhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      getAllResponseHeaders: vi.fn(() => ''),
      send: vi.fn(function (this: { onreadystatechange?: () => void }) {
        this.onreadystatechange?.()
      }),
      status: 401,
      response: {
        code: 401,
        reason: 'APPDEPLOY_WEB_APP_ACCESS_DENIED',
        message: 'You do not have permission to access this web app.',
      },
      readyState: 4,
      upload: {},
      withCredentials: false,
      responseType: '',
    } as unknown as XMLHttpRequest

    await expect(upload({ xhr, data: new FormData() }, true)).rejects.toMatchObject({
      defined: false,
      status: 401,
      data: { reason: 'APPDEPLOY_WEB_APP_ACCESS_DENIED' },
    })

    expect(globalThis.location.href).toContain('/webapp-signin?')
    expect(globalThis.location.href).toContain('code=403')
    expect(mocks.clearWebAppPassport).not.toHaveBeenCalled()
    expect(globalThis.location.reload).not.toHaveBeenCalled()
  })
})
