import { refreshAccessTokenOrReLogin } from './refresh-token'

vi.mock('@/config', () => ({ API_PREFIX: '/console/api' }))
vi.mock('@/utils/client', () => ({ isClient: true }))
it('reissues token refresh after a temporary network rejection', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ status: 200 })
  vi.stubGlobal('fetch', fetch)
  try {
    await refreshAccessTokenOrReLogin(1000)
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally {
    vi.unstubAllGlobals()
    localStorage.clear()
  }
})
