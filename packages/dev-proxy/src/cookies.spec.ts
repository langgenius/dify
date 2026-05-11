/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { rewriteCookieHeaderForUpstream, rewriteSetCookieHeadersForLocal } from './cookies'

describe('dev proxy cookies', () => {
  // Scenario: cookie names should only receive secure host prefixes when configured.
  it('should rewrite configured cookie names for HTTPS upstream requests', () => {
    // Act
    const cookieHeader = rewriteCookieHeaderForUpstream('access_token=abc; theme=dark; passport-app=def', {
      hostPrefixCookies: ['access_token', /^passport-/],
      useHostPrefix: true,
    })

    // Assert
    expect(cookieHeader).toBe('__Host-access_token=abc; theme=dark; __Host-passport-app=def')
  })

  // Scenario: HTTP upstreams should keep local cookie names even when rewrite config exists.
  it('should keep local cookie names for HTTP upstream requests', () => {
    // Act
    const cookieHeader = rewriteCookieHeaderForUpstream('access_token=abc; refresh_token=def', {
      hostPrefixCookies: ['access_token', 'refresh_token'],
      useHostPrefix: false,
    })

    // Assert
    expect(cookieHeader).toBe('access_token=abc; refresh_token=def')
  })

  // Scenario: upstream set-cookie headers should be converted into localhost-safe cookies.
  it('should rewrite upstream set-cookie headers for local development', () => {
    // Act
    const cookies = rewriteSetCookieHeadersForLocal([
      '__Host-access_token=abc; Path=/console/api; Domain=cloud.example.com; Secure; SameSite=None; Partitioned',
    ])

    // Assert
    expect(cookies).toEqual([
      'access_token=abc; Path=/; SameSite=Lax',
    ])
  })
})
