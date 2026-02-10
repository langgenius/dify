import type { ReadonlyURLSearchParams } from 'next/navigation'
import { OAUTH_AUTHORIZE_PENDING_KEY, REDIRECT_URL_KEY } from '@/app/account/oauth/authorize/constants'
import { storage } from '@/utils/storage'
import { resolvePostLoginRedirect } from './post-login-redirect'

const FIXED_DATE = new Date('2026-02-10T12:00:00.000Z')

const createSearchParams = (params: Record<string, string>) => {
  return new URLSearchParams(params) as unknown as ReadonlyURLSearchParams
}

const setPendingRedirect = (value: unknown) => {
  storage.set(OAUTH_AUTHORIZE_PENDING_KEY, value as never)
}

describe('resolvePostLoginRedirect', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    storage.resetCache()
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_DATE)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleErrorSpy.mockRestore()
  })

  describe('redirect_url priority', () => {
    it('should return decoded redirect_url when query param exists', () => {
      // Arrange
      setPendingRedirect({
        value: '/stale-pending',
        expiry: Math.floor(Date.now() / 1000) + 60,
      })
      const redirectUrl = 'https://example.com/account/oauth/authorize?client_id=abc'
      const searchParams = createSearchParams({
        [REDIRECT_URL_KEY]: encodeURIComponent(redirectUrl),
      })

      // Act
      const result = resolvePostLoginRedirect(searchParams)

      // Assert
      expect(result).toBe(redirectUrl)
      expect(storage.get(OAUTH_AUTHORIZE_PENDING_KEY)).toBeNull()
    })

    it('should return original redirect_url when decoding fails', () => {
      // Arrange
      setPendingRedirect({
        value: '/stale-pending',
        expiry: Math.floor(Date.now() / 1000) + 60,
      })
      const malformedRedirectUrl = '%E0%A4%A'
      const searchParams = createSearchParams({
        [REDIRECT_URL_KEY]: malformedRedirectUrl,
      })

      // Act
      const result = resolvePostLoginRedirect(searchParams)

      // Assert
      expect(result).toBe(malformedRedirectUrl)
      expect(storage.get(OAUTH_AUTHORIZE_PENDING_KEY)).toBeNull()
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('pending redirect fallback', () => {
    it('should return pending redirect when redirect_url is absent and pending is valid', () => {
      // Arrange
      const pendingRedirect = 'https://skills.bash-is-all-you-need.dify.dev/account/oauth/authorize?client_id=dcfcd6a4-5799-405a-a6d7-04261b24dd02&redirect_uri=https%3A%2F%2Fcreators.dify.dev%2Fapi%2Fv1%2Foauth%2Fcallback%2Fdify&response_type=code'
      setPendingRedirect({
        value: pendingRedirect,
        expiry: Math.floor(Date.now() / 1000) + 60,
      })

      // Act
      const result = resolvePostLoginRedirect(createSearchParams({}))

      // Assert
      expect(result).toBe(pendingRedirect)
      expect(storage.get(OAUTH_AUTHORIZE_PENDING_KEY)).toBeNull()
    })

    it('should consume pending redirect only once', () => {
      // Arrange
      const pendingRedirect = '/account/oauth/authorize?client_id=one-time'
      setPendingRedirect({
        value: pendingRedirect,
        expiry: Math.floor(Date.now() / 1000) + 60,
      })

      // Act
      const firstResult = resolvePostLoginRedirect(createSearchParams({}))
      const secondResult = resolvePostLoginRedirect(createSearchParams({}))

      // Assert
      expect(firstResult).toBe(pendingRedirect)
      expect(secondResult).toBeNull()
    })

    it('should return null when pending redirect is expired', () => {
      // Arrange
      setPendingRedirect({
        value: '/account/oauth/authorize?client_id=expired',
        expiry: Math.floor(Date.now() / 1000) - 1,
      })

      // Act
      const result = resolvePostLoginRedirect(createSearchParams({}))

      // Assert
      expect(result).toBeNull()
      expect(storage.get(OAUTH_AUTHORIZE_PENDING_KEY)).toBeNull()
    })

    it('should return null when pending redirect payload is invalid', () => {
      // Arrange
      setPendingRedirect({
        value: '/account/oauth/authorize?client_id=invalid',
      })

      // Act
      const result = resolvePostLoginRedirect(createSearchParams({}))

      // Assert
      expect(result).toBeNull()
    })
  })

  describe('empty state', () => {
    it('should return null when no redirect_url and no pending redirect exist', () => {
      // Arrange
      const searchParams = createSearchParams({})

      // Act
      const result = resolvePostLoginRedirect(searchParams)

      // Assert
      expect(result).toBeNull()
    })
  })
})
