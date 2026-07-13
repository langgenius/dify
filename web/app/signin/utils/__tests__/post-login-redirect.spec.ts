import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePostLoginRedirect, setPostLoginRedirect } from '../post-login-redirect'

describe('post-login redirect utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    window.sessionStorage.clear()
  })

  it('should use the redirect_url query param first', () => {
    const searchParams = new URLSearchParams({
      redirect_url: encodeURIComponent('/account/oauth/authorize?client_id=app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback'),
    })

    expect(
      resolvePostLoginRedirect(
        searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0],
      ),
    ).toEqual({
      kind: 'internal',
      href: '/account/oauth/authorize?client_id=app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback',
    })
  })

  it('should allow a trusted Dify absolute query target', () => {
    const searchParams = new URLSearchParams({
      redirect_url: 'https://docs.eu.dify.ai/getting-started',
    })

    expect(
      resolvePostLoginRedirect(
        searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0],
      ),
    ).toEqual({ kind: 'absolute', href: 'https://docs.eu.dify.ai/getting-started' })
  })

  it('should allow an absolute target on the current self-hosted origin', () => {
    const redirectUrl = `${window.location.origin}/apps`
    const searchParams = new URLSearchParams({ redirect_url: redirectUrl })

    expect(
      resolvePostLoginRedirect(
        searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0],
      ),
    ).toEqual({ kind: 'absolute', href: redirectUrl })
  })

  it('should use the default target instead of a stored device target when the query target is invalid', () => {
    setPostLoginRedirect('/device?user_code=ABCD')
    const searchParams = new URLSearchParams({ redirect_url: 'https://google.com' })

    expect(
      resolvePostLoginRedirect(
        searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0],
      ),
    ).toEqual({ kind: 'internal', href: '/' })
    expect(resolvePostLoginRedirect()).toEqual({
      kind: 'internal',
      href: '/device?user_code=ABCD',
    })
  })

  it('should treat an empty redirect_url query param as invalid instead of using device storage', () => {
    setPostLoginRedirect('/device?user_code=ABCD')
    const searchParams = new URLSearchParams('redirect_url=')

    expect(
      resolvePostLoginRedirect(
        searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0],
      ),
    ).toEqual({ kind: 'internal', href: '/' })
    expect(resolvePostLoginRedirect()).toEqual({
      kind: 'internal',
      href: '/device?user_code=ABCD',
    })
  })

  it('should recover a valid device redirect from sessionStorage once', () => {
    setPostLoginRedirect('/device?user_code=ABCD&sso_verified=true')

    expect(resolvePostLoginRedirect()).toEqual({
      kind: 'internal',
      href: '/device?user_code=ABCD&sso_verified=true',
    })
    expect(resolvePostLoginRedirect()).toEqual({ kind: 'internal', href: '/' })
  })

  it('should discard an expired device redirect', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T00:00:00Z'))
    setPostLoginRedirect('/device?user_code=ABCD')
    vi.advanceTimersByTime(15 * 60 * 1000 + 1)

    expect(resolvePostLoginRedirect()).toEqual({ kind: 'internal', href: '/' })
  })

  it('should ignore invalid stored redirects', () => {
    setPostLoginRedirect('https://example.com/device?user_code=ABCD')

    expect(resolvePostLoginRedirect()).toEqual({ kind: 'internal', href: '/' })
  })

  it('should preserve the device path and query-key allowlist', () => {
    setPostLoginRedirect('/device?user_code=ABCD&next=/apps')
    setPostLoginRedirect('/apps')

    expect(resolvePostLoginRedirect()).toEqual({ kind: 'internal', href: '/' })
  })
})
