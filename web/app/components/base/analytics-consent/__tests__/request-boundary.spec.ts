import { isCloudAnalyticsPath, isCloudAnalyticsRequest } from '../request-boundary'

const baseRequest = {
  cookieYesSiteKey: 'site-key',
  isCloudEdition: true,
  isProd: true,
  pathname: '/signin',
  requestHost: 'cloud.dify.ai',
  webPrefix: 'https://cloud.dify.ai',
}

describe('cloud analytics request boundary', () => {
  it('enables first-party Cloud authentication and console routes', () => {
    expect(isCloudAnalyticsRequest(baseRequest)).toBe(true)
    expect(isCloudAnalyticsPath('/apps')).toBe(true)
    expect(isCloudAnalyticsPath('/integrations')).toBe(true)
  })

  it.each([
    '/agent/token',
    '/chat/token',
    '/chatbot/token',
    '/completion/token',
    '/workflow/token',
    '/webapp-signin',
    '/webapp-reset-password/check-code',
  ])('excludes published and embeddable path %s', (pathname) => {
    expect(isCloudAnalyticsPath(pathname)).toBe(false)
    expect(isCloudAnalyticsRequest({ ...baseRequest, pathname })).toBe(false)
  })

  it('does not confuse similarly named console routes with share routes', () => {
    expect(isCloudAnalyticsPath('/workflow-builder')).toBe(true)
  })

  it.each([
    { cookieYesSiteKey: '', reason: 'missing CookieYes configuration' },
    { isCloudEdition: false, reason: 'self-hosted edition' },
    { isProd: false, reason: 'non-production environment' },
    { requestHost: 'udify.app', reason: 'published app host' },
    { requestHost: 'customer.example.com', reason: 'custom host' },
    { webPrefix: undefined, reason: 'missing console origin' },
  ])('disables analytics for $reason', ({ reason: _reason, ...override }) => {
    expect(isCloudAnalyticsRequest({ ...baseRequest, ...override })).toBe(false)
  })

  it('uses the first forwarded host and compares hosts case-insensitively', () => {
    expect(
      isCloudAnalyticsRequest({
        ...baseRequest,
        requestHost: 'CLOUD.DIFY.AI, internal-proxy:3000',
      }),
    ).toBe(true)
  })
})
