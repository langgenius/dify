import { describe, expect, it } from 'vitest'
import {
  getClientLoginFallback,
  getServerLoginFallback,
  resolveLoginRedirectTarget,
} from '../login-redirect'

const currentOrigin = 'http://localhost:3000'

function resolve(raw: string | null | undefined) {
  return resolveLoginRedirectTarget(raw, {
    allowSameOriginAbsolute: true,
    currentOrigin,
  })
}

describe('resolveLoginRedirectTarget', () => {
  describe('allowed targets', () => {
    it.each([
      ['/apps', { kind: 'internal', href: '/apps' }],
      ['/apps?tag=agent#latest', { kind: 'internal', href: '/apps?tag=agent#latest' }],
      ['/discount/100%25', { kind: 'internal', href: '/discount/100%25' }],
      ['/files/%2525', { kind: 'internal', href: '/files/%2525' }],
      [
        '/account/oauth/authorize?client_id=app&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
        {
          kind: 'internal',
          href: '/account/oauth/authorize?client_id=app&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
        },
      ],
    ])('should allow the internal target %s', (raw, expected) => {
      expect(resolve(raw)).toEqual(expected)
    })

    it.each(['http://localhost:3000/apps', 'http://localhost:3000/apps?tag=agent#latest'])(
      'should allow the same-origin absolute target %s',
      (raw) => {
        expect(resolve(raw)).toEqual({ kind: 'absolute', href: raw })
      },
    )

    it.each([
      ['https://dify.ai', 'https://dify.ai/'],
      ['https://cloud.dify.ai/apps', 'https://cloud.dify.ai/apps'],
      [
        'https://docs.eu.dify.ai/path?from=login#section',
        'https://docs.eu.dify.ai/path?from=login#section',
      ],
      ['https://dify.ai:443/apps', 'https://dify.ai/apps'],
    ])('should allow the trusted Dify target %s', (raw, expected) => {
      expect(resolve(raw)).toEqual({ kind: 'absolute', href: expected })
    })

    it('should allow a same-origin custom HTTPS port', () => {
      expect(
        resolveLoginRedirectTarget('https://self-hosted.example:8443/apps', {
          allowSameOriginAbsolute: true,
          currentOrigin: 'https://self-hosted.example:8443',
        }),
      ).toEqual({ kind: 'absolute', href: 'https://self-hosted.example:8443/apps' })
    })
  })

  describe('legacy encoding compatibility', () => {
    it.each([
      ['%2Fapps%3Ftag%3Dagent%23latest', { kind: 'internal', href: '/apps?tag=agent#latest' }],
      [
        'https%3A%2F%2Fcloud.dify.ai%2Fapps',
        { kind: 'absolute', href: 'https://cloud.dify.ai/apps' },
      ],
    ])('should decode the legacy target %s once', (raw, expected) => {
      expect(resolve(raw)).toEqual(expected)
    })

    it('should preserve an encoded nested OAuth callback when the top-level target is already valid', () => {
      const raw =
        '/account/oauth/authorize?client_id=app&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback%3Fnext%3D%252Fdone'

      expect(resolve(raw)).toEqual({ kind: 'internal', href: raw })
    })
  })

  describe('rejected targets', () => {
    it.each([
      null,
      undefined,
      '',
      ' ',
      'apps',
      'https://google.com',
      'http://cloud.dify.ai',
      'https://cloud.dify.ai:444/apps',
      'https://dify.ai.evil.example',
      'https://evildify.ai',
      'https://dify.ai@evil.example',
      'https://user:password@dify.ai',
      'javascript:alert(1)',
      'data:text/html,hello',
      'blob:http://localhost:3000/redirect',
      '//evil.example',
      '///evil.example',
      '\\\\evil.example',
      '/\\evil.example',
      '/path\\to\\resource',
      'https://cloud.dify.ai//evil.example',
      'http://localhost:3000//evil.example',
      '/%2Fevil.example',
      '/%252Fevil.example',
      '/%5Cevil.example',
      '/%255Cevil.example',
      '/%252e%252e//evil.example',
      '%2F%2Fevil.example',
      '%252F%252Fevil.example',
      '%5C%5Cevil.example',
      '%255C%255Cevil.example',
      '/apps%ZZ',
      '/apps%252G',
      '/%2500evil.example',
      ' https://dify.ai',
      'https://dify.ai\n.evil.example',
    ])('should reject %s', (raw) => {
      expect(resolve(raw)).toBeNull()
    })

    it('should reject a same-origin absolute URL when same-origin absolute targets are disabled', () => {
      expect(
        resolveLoginRedirectTarget('http://localhost:3000/apps', {
          allowSameOriginAbsolute: false,
          currentOrigin,
        }),
      ).toBeNull()
    })

    it('should reject a malformed current origin without throwing', () => {
      expect(
        resolveLoginRedirectTarget('https://self-hosted.example/apps', {
          allowSameOriginAbsolute: true,
          currentOrigin: 'not an origin',
        }),
      ).toBeNull()
    })
  })
})

describe('login redirect fallbacks', () => {
  it('should use the Cloud console home for the client Cloud fallback', () => {
    expect(getClientLoginFallback(true)).toEqual({
      kind: 'absolute',
      href: 'https://cloud.dify.ai/',
    })
  })

  it('should use an internal root for the client self-hosted fallback', () => {
    expect(getClientLoginFallback(false)).toEqual({ kind: 'internal', href: '/' })
  })

  it.each([
    ['', '/'],
    ['/', '/'],
    ['/console', '/console/'],
    ['/console/', '/console/'],
  ])('should include basePath %s in the server self-hosted fallback', (basePath, href) => {
    expect(getServerLoginFallback(false, basePath)).toEqual({ kind: 'internal', href })
  })

  it('should use the Cloud console home for the server Cloud fallback', () => {
    expect(getServerLoginFallback(true, '/console')).toEqual({
      kind: 'absolute',
      href: 'https://cloud.dify.ai/',
    })
  })
})
