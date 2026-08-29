import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const getMock = vi.hoisted(() => vi.fn())

vi.mock('./base', () => ({
  del: vi.fn(),
  delPublic: vi.fn(),
  get: vi.fn(),
  getPublic: getMock,
  patch: vi.fn(),
  patchPublic: vi.fn(),
  post: vi.fn(),
  postPublic: vi.fn(),
  ssePost: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('./webapp-auth', () => ({
  getOrCreateWebAppVisitorId: vi.fn(() => 'visitor-1'),
  getWebAppAccessToken: vi.fn(() => ''),
}))

const { fetchAccessToken } = await import('./share')

describe('fetchAccessToken', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('shares an in-flight passport request for the same environment', async () => {
    window.history.replaceState({}, '', '/environment/workflow/environment-app')
    let resolveRequest: (value: { access_token: string }) => void = () => {}
    getMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )

    const firstRequest = fetchAccessToken({ appCode: 'environment-app' })
    const secondRequest = fetchAccessToken({ appCode: 'environment-app' })

    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledWith('/passport?user_id=visitor-1', expect.anything())

    resolveRequest({ access_token: 'passport' })
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      { access_token: 'passport' },
      { access_token: 'passport' },
    ])

    await fetchAccessToken({ appCode: 'environment-app' })
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('does not coalesce ordinary Web App passport requests', async () => {
    window.history.replaceState({}, '', '/workflow/ordinary-app')
    getMock.mockResolvedValue({ access_token: 'passport' })

    await Promise.all([
      fetchAccessToken({ appCode: 'ordinary-app' }),
      fetchAccessToken({ appCode: 'ordinary-app' }),
    ])

    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('starts a new environment passport request after a failure', async () => {
    window.history.replaceState({}, '', '/environment/workflow/environment-app')
    const error = new Response(null, { status: 401 })
    getMock.mockRejectedValueOnce(error).mockResolvedValueOnce({ access_token: 'passport' })

    await expect(fetchAccessToken({ appCode: 'environment-app' })).rejects.toBe(error)
    await expect(fetchAccessToken({ appCode: 'environment-app' })).resolves.toEqual({
      access_token: 'passport',
    })

    expect(getMock).toHaveBeenCalledTimes(2)
  })
})
