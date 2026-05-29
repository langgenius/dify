import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePostLoginRedirect, setPostLoginRedirect } from '../post-login-redirect'

describe('post-login redirect utilities', () => {
  beforeEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('should use the redirect_url query param first', () => {
    const searchParams = new URLSearchParams({
      redirect_url: encodeURIComponent('/account/oauth/authorize?client_id=app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback'),
    })

    expect(resolvePostLoginRedirect(searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0])).toBe('/account/oauth/authorize?client_id=app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback')
  })

  it('should recover a valid device redirect from sessionStorage once', () => {
    setPostLoginRedirect('/device?user_code=ABCD&sso_verified=true')

    expect(resolvePostLoginRedirect()).toBe('/device?user_code=ABCD&sso_verified=true')
    expect(resolvePostLoginRedirect()).toBeNull()
  })

  it('should ignore invalid stored redirects', () => {
    setPostLoginRedirect('https://example.com/device?user_code=ABCD')

    expect(resolvePostLoginRedirect()).toBeNull()
  })
})
