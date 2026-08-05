import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  })

  afterEach(() => {
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

    await expect(request('/account/profile')).rejects.toBe(response)

    expect(globalThis.location.href).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps?category=agent#recent')}`,
    )
    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('should preserve the current URL when token refresh fails', async () => {
    const response = createUnauthorizedResponse()
    arrangeClientRequest({
      response,
      refreshError: new Error('refresh failed'),
    })

    await expect(request('/account/profile')).rejects.toBe(response)

    expect(mocks.refreshAccessTokenOrReLogin).toHaveBeenCalledOnce()
    expect(globalThis.location.href).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps?category=agent#recent')}`,
    )
  })
})
