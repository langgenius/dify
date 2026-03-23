import { resolvePostLoginRedirect, setPostLoginRedirect } from './post-login-redirect'

describe('resolvePostLoginRedirect', () => {
  beforeEach(() => {
    setPostLoginRedirect(null)
  })

  it('should return null when no redirect is set', () => {
    const result = resolvePostLoginRedirect()
    expect(result).toBeNull()
  })

  it('should return the redirect url when set', () => {
    const url = '/account/oauth/authorize?client_id=abc'
    setPostLoginRedirect(url)

    const result = resolvePostLoginRedirect()
    expect(result).toBe(url)
  })

  it('should consume the redirect only once', () => {
    setPostLoginRedirect('/one-time')

    const first = resolvePostLoginRedirect()
    const second = resolvePostLoginRedirect()

    expect(first).toBe('/one-time')
    expect(second).toBeNull()
  })

  it('should allow overwriting with a new value', () => {
    setPostLoginRedirect('/first')
    setPostLoginRedirect('/second')

    const result = resolvePostLoginRedirect()
    expect(result).toBe('/second')
  })

  it('should allow clearing by setting null', () => {
    setPostLoginRedirect('/something')
    setPostLoginRedirect(null)

    const result = resolvePostLoginRedirect()
    expect(result).toBeNull()
  })
})
