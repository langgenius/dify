import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  discardRegistrationSessionState,
  OAUTH_REGISTRATION_GA_SENT_KEY,
  REGISTRATION_SUCCESS_STORAGE_KEY,
} from '@/app/components/base/amplitude/registration-session-state'
// oxlint-disable-next-line no-restricted-imports -- This spec directly tests the legacy request owner.
import { request } from '../base'

const mocks = vi.hoisted(() => ({
  isClient: true,
  baseFetch: vi.fn(),
  refreshAccessTokenOrReLogin: vi.fn(),
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

vi.mock('../fetch', () => ({
  base: mocks.baseFetch,
  ContentType: {
    audio: 'audio/mpeg',
    download: 'application/octet-stream',
    downloadZip: 'application/zip',
    json: 'application/json',
  },
  getBaseOptions: vi.fn(() => ({})),
}))

vi.mock('../refresh-token', () => ({
  refreshAccessTokenOrReLogin: mocks.refreshAccessTokenOrReLogin,
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
  mocks.baseFetch.mockRejectedValue(response)
  if (refreshError) mocks.refreshAccessTokenOrReLogin.mockRejectedValue(refreshError)
}

describe('request 401 handling', () => {
  const originalLocation = globalThis.location

  beforeEach(() => {
    mocks.isClient = true
    mocks.baseFetch.mockReset()
    mocks.refreshAccessTokenOrReLogin.mockReset()
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/app/apps',
        search: '?category=agent',
        hash: '#recent',
        href: 'https://example.com/app/apps?category=agent#recent',
        reload: vi.fn(),
      },
      writable: true,
      configurable: true,
    })
    window.sessionStorage.clear()
  })

  afterEach(() => {
    discardRegistrationSessionState()
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('should not run browser auth recovery when handling 401 on the server', async () => {
    const response = createUnauthorizedResponse()
    mocks.isClient = false
    mocks.baseFetch.mockRejectedValue(response)

    await expect(request('/account/profile')).rejects.toBe(response)

    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('should preserve the current URL when a 401 response cannot be parsed', async () => {
    const response = new Response('not-json', { status: 401 })
    arrangeClientRequest({ response })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'account-a-marker')

    await expect(request('/account/profile')).rejects.toBe(response)

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

    await expect(request('/account/profile')).rejects.toBe(response)

    expect(reload).toHaveBeenCalledOnce()
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'account-b-marker')
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('account-b-marker')
  })

  it('should preserve the current URL when token refresh fails', async () => {
    const response = createUnauthorizedResponse()
    arrangeClientRequest({
      response,
      refreshError: new Error('refresh failed'),
    })
    window.sessionStorage.setItem(REGISTRATION_SUCCESS_STORAGE_KEY, 'account-a-marker')

    await expect(request('/account/profile')).rejects.toBe(response)

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

    await expect(request('/account/profile', {}, { isPublicAPI: true })).rejects.toBe(response)

    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBe('console-marker')
  })
})
