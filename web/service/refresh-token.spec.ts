import { ORPCError } from '@orpc/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { refreshAccessTokenOrReLogin } from './refresh-token'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('token refresh HTTP failures', () => {
  it.each([400, 401, 503])(
    'rejects HTTP %s as ORPCError and releases the refresh lock',
    async (status) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ code: 'refresh_failed', message: 'Refresh failed' }, { status }),
      )
      const error = await refreshAccessTokenOrReLogin(1000).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ORPCError)
      expect(error).toMatchObject({ code: 'refresh_failed', message: 'Refresh failed', status })
      expect(localStorage.getItem('is_other_tab_refreshing')).toBeNull()
    },
  )

  it('resolves a successful refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ result: 'success' }))
    await expect(refreshAccessTokenOrReLogin(1000)).resolves.toBeUndefined()
    expect(localStorage.getItem('is_other_tab_refreshing')).toBeNull()
  })
})
