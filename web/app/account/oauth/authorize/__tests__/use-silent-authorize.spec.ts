import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { buildOAuthCallbackUrl, buildReturnUrl } from '../use-silent-authorize'

describe('buildReturnUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefixes the current origin', () => {
    vi.stubGlobal('location', { origin: 'https://dify.test' })

    expect(buildReturnUrl('/account/oauth/authorize', '?a=1')).toBe(
      'https://dify.test/account/oauth/authorize?a=1',
    )
  })

  it('falls back to a relative URL when location is unavailable', () => {
    vi.stubGlobal('location', undefined)

    expect(buildReturnUrl('/account/oauth/authorize', '?a=1')).toBe('/account/oauth/authorize?a=1')
  })
})

describe('buildOAuthCallbackUrl', () => {
  it('appends code and state to the redirect URI', () => {
    expect(buildOAuthCallbackUrl('https://client.example.com/callback', 'code-1', 'state-1')).toBe(
      'https://client.example.com/callback?code=code-1&state=state-1',
    )
  })

  it('omits a null state', () => {
    expect(buildOAuthCallbackUrl('https://client.example.com/callback', 'code-1', null)).toBe(
      'https://client.example.com/callback?code=code-1',
    )
  })
})
