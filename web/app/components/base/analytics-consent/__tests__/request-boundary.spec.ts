import { isCloudAnalyticsRequest } from '../request-boundary'

const baseRequest = {
  cookieYesSiteKey: 'site-key',
  deploymentEdition: 'CLOUD',
  isProd: true,
  requestHost: 'cloud.dify.ai',
  webPrefix: 'https://cloud.dify.ai',
} as const

describe('cloud analytics request boundary', () => {
  it('enables first-party Cloud requests', () => {
    expect(isCloudAnalyticsRequest(baseRequest)).toBe(true)
  })

  it.each([
    { cookieYesSiteKey: '', reason: 'missing CookieYes configuration' },
    { deploymentEdition: 'COMMUNITY' as const, reason: 'non-Cloud edition' },
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
