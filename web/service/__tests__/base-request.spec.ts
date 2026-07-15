import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

async function loadServerRequest() {
  vi.resetModules()

  const mockBaseFetch = vi.fn(async () => {
    throw createUnauthorizedResponse()
  })
  const mockRefreshAccessTokenOrReLogin = vi.fn()

  vi.doMock('@/utils/client', () => ({
    isClient: false,
    isServer: true,
  }))
  vi.doMock('../fetch', () => ({
    base: mockBaseFetch,
    ContentType: {
      audio: 'audio/mpeg',
      download: 'application/octet-stream',
      downloadZip: 'application/zip',
      json: 'application/json',
    },
    getBaseOptions: vi.fn(() => ({})),
  }))
  vi.doMock('../refresh-token', () => ({
    refreshAccessTokenOrReLogin: mockRefreshAccessTokenOrReLogin,
  }))

  const { request } = await import('../base')

  return {
    request,
    mockRefreshAccessTokenOrReLogin,
  }
}

type ClientRequestOptions = {
  response: Response
  refreshError?: Error
}

async function loadClientRequest({ response, refreshError }: ClientRequestOptions) {
  vi.resetModules()

  const mockBaseFetch = vi.fn(async () => {
    throw response
  })
  const mockRefreshAccessTokenOrReLogin = refreshError
    ? vi.fn().mockRejectedValue(refreshError)
    : vi.fn()

  vi.doMock('@/utils/client', () => ({
    isClient: true,
    isServer: false,
  }))
  vi.doMock('@/utils/var', () => ({
    basePath: '/app',
  }))
  vi.doMock('../fetch', () => ({
    base: mockBaseFetch,
    ContentType: {
      audio: 'audio/mpeg',
      download: 'application/octet-stream',
      downloadZip: 'application/zip',
      json: 'application/json',
    },
    getBaseOptions: vi.fn(() => ({})),
  }))
  vi.doMock('../refresh-token', () => ({
    refreshAccessTokenOrReLogin: mockRefreshAccessTokenOrReLogin,
  }))

  const { request } = await import('../base')

  return {
    request,
    mockRefreshAccessTokenOrReLogin,
  }
}

describe('request 401 handling', () => {
  const originalLocation = globalThis.location

  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('should not run browser auth recovery when handling 401 on the server', async () => {
    const { request, mockRefreshAccessTokenOrReLogin } = await loadServerRequest()

    await expect(request('/account/profile')).rejects.toMatchObject({ status: 401 })

    expect(mockRefreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('should preserve the current URL when a 401 response cannot be parsed', async () => {
    const response = new Response('not-json', { status: 401 })
    const { request, mockRefreshAccessTokenOrReLogin } = await loadClientRequest({ response })

    await expect(request('/account/profile')).rejects.toBe(response)

    expect(globalThis.location.href).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps?category=agent#recent')}`,
    )
    expect(mockRefreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })

  it('should preserve the current URL when token refresh fails', async () => {
    const response = createUnauthorizedResponse()
    const { request, mockRefreshAccessTokenOrReLogin } = await loadClientRequest({
      response,
      refreshError: new Error('refresh failed'),
    })

    await expect(request('/account/profile')).rejects.toBe(response)

    expect(mockRefreshAccessTokenOrReLogin).toHaveBeenCalledOnce()
    expect(globalThis.location.href).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps?category=agent#recent')}`,
    )
  })
})
