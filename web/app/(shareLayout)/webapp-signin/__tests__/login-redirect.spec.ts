import { resolveWebAppLoginRedirect } from '../login-redirect'

describe('resolveWebAppLoginRedirect', () => {
  // Covers the canonical relative redirect shape used by share applications.
  describe('internal targets', () => {
    it('should return the sanitized target and app code for a legacy encoded path', () => {
      const result = resolveWebAppLoginRedirect(
        encodeURIComponent('/chatbot/share-app?foo=bar#answer'),
        'https://self-hosted.example.com',
      )

      expect(result).toEqual({
        appCode: 'share-app',
        target: { kind: 'internal', href: '/chatbot/share-app?foo=bar#answer' },
      })
    })

    it('should preserve a nested OAuth callback without validating it as the top-level target', () => {
      const redirectUrl = '/chatbot/share-app?redirect_uri=https%3A%2F%2Fclient.example%2Fcallback'

      const result = resolveWebAppLoginRedirect(redirectUrl, 'https://self-hosted.example.com')

      expect(result?.target.href).toBe(redirectUrl)
      expect(result?.appCode).toBe('share-app')
    })
  })

  // Covers absolute destinations accepted by the shared login redirect policy.
  describe('absolute targets', () => {
    it('should accept a same-origin self-hosted URL with a custom port', () => {
      const result = resolveWebAppLoginRedirect(
        'http://self-hosted.example.com:8080/chatbot/share-app',
        'http://self-hosted.example.com:8080',
      )

      expect(result).toEqual({
        appCode: 'share-app',
        target: {
          kind: 'absolute',
          href: 'http://self-hosted.example.com:8080/chatbot/share-app',
        },
      })
    })

    it('should accept a trusted Dify subdomain URL', () => {
      const result = resolveWebAppLoginRedirect(
        'https://apps.eu.dify.ai/chatbot/share-app',
        'https://cloud.dify.ai',
      )

      expect(result?.appCode).toBe('share-app')
      expect(result?.target.kind).toBe('absolute')
    })
  })

  // Invalid targets must not be allowed to influence application identity.
  describe('invalid targets', () => {
    it.each([
      null,
      '',
      '/',
      '/webapp-signin',
      '/webapp-signin/check-code',
      '/console/webapp-signin/check-code',
      'https://evil.example/chatbot/evil-app',
      '//evil.example/chatbot/evil-app',
    ])('should return null for %s', (redirectUrl) => {
      expect(resolveWebAppLoginRedirect(redirectUrl, 'https://self-hosted.example.com')).toBeNull()
    })
  })
})
