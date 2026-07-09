import { afterEach, describe, expect, it, vi } from 'vitest'

const createUnauthorizedResponse = () =>
  new Response(JSON.stringify({
    code: 'unauthorized',
    message: 'Invalid Authorization token.',
    status: 401,
  }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
    },
  })

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

describe('request 401 handling', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('should not run browser auth recovery when handling 401 on the server', async () => {
    const { request, mockRefreshAccessTokenOrReLogin } = await loadServerRequest()

    await expect(request('/account/profile')).rejects.toMatchObject({ status: 401 })

    expect(mockRefreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })
})
