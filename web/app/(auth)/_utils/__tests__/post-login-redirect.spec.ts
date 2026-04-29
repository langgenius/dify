import {
  createAuthSearchParams,
  resolvePostLoginRedirect,
  sanitizePostLoginRedirect,
} from '../post-login-redirect'

describe('post-login redirect utilities', () => {
  const originalLocation = globalThis.location

  beforeEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/signin',
        search: '',
        hash: '',
        href: 'https://example.com/signin',
      },
      writable: true,
      configurable: true,
    })
    localStorage.clear()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('allows relative redirects', () => {
    expect(sanitizePostLoginRedirect('/apps?category=workflow#top')).toBe('/apps?category=workflow#top')
  })

  it('normalizes same-origin absolute redirects to path-only URLs', () => {
    expect(sanitizePostLoginRedirect('https://example.com/explore/apps?q=test')).toBe('/explore/apps?q=test')
  })

  it('rejects cross-origin redirects', () => {
    expect(sanitizePostLoginRedirect('https://evil.example.com/phish')).toBeNull()
  })

  it('rejects malformed redirects', () => {
    expect(sanitizePostLoginRedirect('http://[')).toBeNull()
  })

  it('rejects auth public route redirects', () => {
    expect(sanitizePostLoginRedirect('/signin?step=next')).toBeNull()
    expect(sanitizePostLoginRedirect('/reset-password/set-password')).toBeNull()
  })

  it('resolves encoded safe redirect_url search params', () => {
    const searchParams = new URLSearchParams(`redirect_url=${encodeURIComponent('/account/oauth/authorize?client_id=abc')}`)

    expect(resolvePostLoginRedirect(searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0])).toBe('/account/oauth/authorize?client_id=abc')
  })

  it('drops unsafe redirect_url search params', () => {
    const searchParams = new URLSearchParams(`redirect_url=${encodeURIComponent('https://evil.example.com')}`)

    expect(resolvePostLoginRedirect(searchParams as unknown as Parameters<typeof resolvePostLoginRedirect>[0])).toBeNull()
  })

  it('copies only auth flow query params', () => {
    const searchParams = new URLSearchParams('email=a%40example.com&foo=bar&invite_token=token&redirect_url=%2Fapps')

    expect(createAuthSearchParams(searchParams).toString()).toBe('email=a%40example.com&invite_token=token&redirect_url=%2Fapps')
  })
})
