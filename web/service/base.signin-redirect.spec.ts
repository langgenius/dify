import { describe, expect, it } from 'vitest'
import { buildSigninUrlWithRedirect } from './base'

describe('buildSigninUrlWithRedirect', () => {
  describe('OAuth callback preservation', () => {
    it('should include the full current OAuth authorize URL in oauth_redirect_url', () => {
      // Arrange
      const currentLocation = {
        origin: 'https://skills.bash-is-all-you-need.dify.dev',
        pathname: '/account/oauth/authorize',
        search: '?client_id=dcfcd6a4-5799-405a-a6d7-04261b24dd02&redirect_uri=https%3A%2F%2Fcreators.dify.dev%2Fapi%2Fv1%2Foauth%2Fcallback%2Fdify&response_type=code',
      } as const

      // Act
      const signinUrl = buildSigninUrlWithRedirect(currentLocation, '')
      const parsedSigninUrl = new URL(signinUrl)

      // Assert
      expect(parsedSigninUrl.pathname).toBe('/signin')
      const encodedRedirect = parsedSigninUrl.searchParams.get('oauth_redirect_url')
      expect(encodedRedirect).toBeTruthy()
      expect(decodeURIComponent(encodedRedirect!)).toBe(`${currentLocation.origin}${currentLocation.pathname}${currentLocation.search}`)
    })
  })

  describe('Non-OAuth redirect handling', () => {
    it('should return plain signin URL without oauth_redirect_url for generic pages', () => {
      // Arrange
      const currentLocation = {
        origin: 'https://example.com',
        pathname: '/apps',
        search: '?tab=all',
      } as const

      // Act
      const signinUrl = buildSigninUrlWithRedirect(currentLocation, '')

      // Assert
      expect(signinUrl).toBe('https://example.com/signin')
    })
  })

  describe('Signin self-redirect guard', () => {
    it('should return plain signin URL when current path is already signin', () => {
      // Arrange
      const currentLocation = {
        origin: 'https://skills.bash-is-all-you-need.dify.dev',
        pathname: '/signin',
        search: '?oauth_redirect_url=https%3A%2F%2Fskills.bash-is-all-you-need.dify.dev%2Faccount%2Foauth%2Fauthorize',
      } as const

      // Act
      const signinUrl = buildSigninUrlWithRedirect(currentLocation, '')

      // Assert
      expect(signinUrl).toBe('https://skills.bash-is-all-you-need.dify.dev/signin')
    })
  })

  describe('basePath support', () => {
    it('should respect basePath for OAuth authorize path', () => {
      // Arrange
      const currentLocation = {
        origin: 'https://example.com',
        pathname: '/console/account/oauth/authorize',
        search: '?client_id=abc',
      } as const

      // Act
      const signinUrl = buildSigninUrlWithRedirect(currentLocation, '/console')

      // Assert
      expect(signinUrl.startsWith('https://example.com/console/signin?')).toBe(true)
      const encodedRedirect = new URL(signinUrl).searchParams.get('oauth_redirect_url')
      expect(decodeURIComponent(encodedRedirect || '')).toBe('https://example.com/console/account/oauth/authorize?client_id=abc')
    })
  })
})
