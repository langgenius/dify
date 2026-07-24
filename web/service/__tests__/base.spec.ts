import {
  buildSigninUrlWithRedirect,
  buildWebAppSigninUrlWithRedirect,
  isWebAppSigninPath,
} from '../base'

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
        pathname: '/app/apps',
        search: '?category=agent',
        hash: '#recent',
        href: 'https://example.com/app/apps?category=agent#recent',
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

  it('should preserve the current internal URL for Console pages', () => {
    const url = buildSigninUrlWithRedirect()
    expect(url).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/app/apps?category=agent#recent')}`,
    )
  })

  it('should append redirect_url for OAuth authorize pages', () => {
    const oauthHref = 'https://example.com/account/oauth/authorize?client_id=abc&state=xyz'
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/account/oauth/authorize',
        search: '?client_id=abc&state=xyz',
        hash: '',
        href: oauthHref,
      },
      writable: true,
      configurable: true,
    })

    const url = buildSigninUrlWithRedirect()
    expect(url).toBe(`https://example.com/app/signin?redirect_url=${encodeURIComponent(oauthHref)}`)
  })

  it('should treat other paths containing a partial OAuth match as Console pages', () => {
    Object.defineProperty(globalThis, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/settings/oauth',
        search: '',
        hash: '',
        href: 'https://example.com/settings/oauth',
      },
      writable: true,
      configurable: true,
    })

    const url = buildSigninUrlWithRedirect()
    expect(url).toBe(
      `https://example.com/app/signin?redirect_url=${encodeURIComponent('/settings/oauth')}`,
    )
  })

  it.each(['/app/signin', '/app/signin/'])(
    'should not create a self-referential redirect for the signin page: %s',
    (pathname) => {
      Object.defineProperty(globalThis, 'location', {
        value: {
          origin: 'https://example.com',
          pathname,
          search: '?redirect_url=%2Fapp%2Fapps',
          hash: '',
          href: `https://example.com${pathname}?redirect_url=%2Fapp%2Fapps`,
        },
        writable: true,
        configurable: true,
      })

      expect(buildSigninUrlWithRedirect()).toBe('https://example.com/app/signin')
    },
  )
})

describe('buildWebAppSigninUrlWithRedirect', () => {
  it('should encode the internal redirect target exactly once', () => {
    const url = buildWebAppSigninUrlWithRedirect(
      'https://example.com',
      '/chatbot/share-app',
      '?foo=bar',
    )

    expect(url).toBe(
      'https://example.com/app/webapp-signin?redirect_url=%2Fchatbot%2Fshare-app%3Ffoo%3Dbar',
    )
    expect(new URL(url).searchParams.get('redirect_url')).toBe('/chatbot/share-app?foo=bar')
  })
})

describe('isWebAppSigninPath', () => {
  it.each(['/app/webapp-signin', '/app/webapp-signin/'])(
    'should recognize the web app signin route behind basePath: %s',
    (pathname) => {
      expect(isWebAppSigninPath(pathname)).toBe(true)
    },
  )

  it.each(['/webapp-signin', '/app/webapp-signin-extra', '/app/webapp-signin/check-code'])(
    'should not match a different path: %s',
    (pathname) => {
      expect(isWebAppSigninPath(pathname)).toBe(false)
    },
  )
})
