import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshAccessTokenOrReLogin } from './refresh-token'

const mockFetchWithRetry = vi.fn()

vi.mock('@/utils', () => ({
  fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('refreshAccessTokenOrReLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    localStorage.clear()
    globalThis.fetch = vi.fn()
  })

  describe('stale cross-tab lock handling', () => {
    it('should clean stale lock and execute refresh request', async () => {
      // Arrange
      localStorage.setItem('is_other_tab_refreshing', '1')
      localStorage.setItem('last_refresh_time', `${Date.now() - 30_000}`)
      mockFetchWithRetry.mockResolvedValue([null, new Response(null, { status: 200 })])

      // Act
      await refreshAccessTokenOrReLogin(5_000)

      // Assert
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem('is_other_tab_refreshing')).toBeNull()
      expect(localStorage.getItem('last_refresh_time')).toBeNull()
    })
  })

  describe('concurrent refresh requests', () => {
    it('should avoid duplicate refresh calls when a refresh is already in progress', async () => {
      // Arrange
      const deferredRefresh = createDeferred<[null, Response]>()
      mockFetchWithRetry.mockImplementation(() => deferredRefresh.promise)

      // Act
      const firstRefresh = refreshAccessTokenOrReLogin(5_000)
      const secondRefresh = refreshAccessTokenOrReLogin(5_000)
      deferredRefresh.resolve([null, new Response(null, { status: 200 })])

      // Assert
      await expect(firstRefresh).resolves.toBeUndefined()
      await expect(secondRefresh).resolves.toBeUndefined()
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem('is_other_tab_refreshing')).toBeNull()
      expect(localStorage.getItem('last_refresh_time')).toBeNull()
    })
  })

  describe('waiter behavior', () => {
    it('should wait for another tab lock to release without issuing duplicate refresh', async () => {
      // Arrange
      vi.useFakeTimers()
      localStorage.setItem('is_other_tab_refreshing', 'other-tab-token')
      localStorage.setItem('last_refresh_time', `${Date.now()}`)

      // Act
      const waitingRefresh = refreshAccessTokenOrReLogin(5_000)
      setTimeout(() => {
        localStorage.removeItem('is_other_tab_refreshing')
        localStorage.removeItem('last_refresh_time')
      }, 300)
      await vi.advanceTimersByTimeAsync(1_000)

      // Assert
      await expect(waitingRefresh).resolves.toBeUndefined()
      expect(mockFetchWithRetry).not.toHaveBeenCalled()
    })
  })
})
