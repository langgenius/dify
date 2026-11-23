import { ORPCError } from '@orpc/client'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vite-plus/test'
import { refreshAccessTokenOrReLogin } from './refresh-token'
import { getSessionRefreshRevision, subscribeToSessionRefresh } from './session-refresh-events'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('token refresh', () => {
  it.each([400, 401, 503])(
    'rejects HTTP %s as ORPCError and releases the refresh lock',
    async (status) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ code: 'refresh_failed', message: 'Refresh failed' }, { status }),
      )
      const revision = getSessionRefreshRevision()
      const error = await refreshAccessTokenOrReLogin(1000).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ORPCError)
      expect(error).toMatchObject({ code: 'refresh_failed', message: 'Refresh failed', status })
      expect(localStorage.getItem('is_other_tab_refreshing')).toBeNull()
      expect(getSessionRefreshRevision()).toBe(revision)
    },
  )

  it('notifies listeners after the refresh endpoint succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ result: 'success' }))
    const revision = getSessionRefreshRevision()
    const listener = vi.fn()
    onTestFinished(subscribeToSessionRefresh(listener))

    await expect(refreshAccessTokenOrReLogin(1000)).resolves.toBeUndefined()

    expect(localStorage.getItem('is_other_tab_refreshing')).toBeNull()
    expect(getSessionRefreshRevision()).toBe(revision + 1)
    expect(listener).toHaveBeenCalledOnce()
  })
})
