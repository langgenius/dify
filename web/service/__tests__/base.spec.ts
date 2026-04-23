import { buildSigninUrlWithRedirect } from '../base'

vi.mock('@/utils/var', () => ({
  basePath: '/app',
  API_PREFIX: '/console/api',
  PUBLIC_API_PREFIX: '/api',
  IS_CE_EDITION: false,
}))

describe('buildSigninUrlWithRedirect', () => {
  const originalLocation = globalThis.location

  beforeEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/apps',
        href: 'https://example.com/apps',
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('should return plain signin URL for non-OAuth pages', () => {
    const url = buildSigninUrlWithRedirect()
    expect(url).toBe('https://example.com/app/signin')
  })

  it('should append redirect_url for OAuth authorize pages', () => {
    const oauthHref = 'https://example.com/account/oauth/authorize?client_id=abc&state=xyz'
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/account/oauth/authorize',
        href: oauthHref,
      },
      writable: true,
      configurable: true,
    })

    const url = buildSigninUrlWithRedirect()
    expect(url).toBe(`https://example.com/app/signin?redirect_url=${encodeURIComponent(oauthHref)}`)
  })

  it('should not include redirect_url for other paths containing partial match', () => {
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/settings/oauth',
        href: 'https://example.com/settings/oauth',
      },
      writable: true,
      configurable: true,
    })

    const url = buildSigninUrlWithRedirect()
    expect(url).toBe('https://example.com/app/signin')
  })
})
