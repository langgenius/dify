import type { AnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { act, render, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setAnalyticsConsent } from '@/app/components/base/analytics-consent/consent-store'
import { useSearchParams } from '@/next/navigation'
import ExternalAttributionRecorder from '../external-attribution-recorder'

const mockConfig = vi.hoisted(() => ({ IS_CLOUD_EDITION: true }))
const { mockRememberCreateAppExternalAttribution } = vi.hoisted(() => ({
  mockRememberCreateAppExternalAttribution: vi.fn(),
}))

vi.mock('@/config', () => ({
  get IS_CLOUD_EDITION() {
    return mockConfig.IS_CLOUD_EDITION
  },
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  rememberCreateAppExternalAttribution: (...args: unknown[]) =>
    mockRememberCreateAppExternalAttribution(...args),
}))

const mockUseSearchParams = vi.mocked(useSearchParams)

const setSearchParams = (search = '') => {
  mockUseSearchParams.mockReturnValue(
    new URLSearchParams(search) as unknown as ReturnType<typeof useSearchParams>,
  )
}

const getUtmInfoCookie = () => {
  const raw = Cookies.get('utm_info')
  return raw ? JSON.parse(raw) : null
}

describe('ExternalAttributionRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Cookies.remove('utm_info')
    mockConfig.IS_CLOUD_EDITION = true
    setAnalyticsConsent('granted')
    setSearchParams()
  })

  it.each<AnalyticsConsent>(['unknown', 'denied'])(
    'does not persist attribution when analytics consent is %s',
    (consent) => {
      setAnalyticsConsent(consent)
      setSearchParams('utm_source=dify_blog&slug=get-started-with-dify')

      render(<ExternalAttributionRecorder />)

      expect(getUtmInfoCookie()).toBeNull()
      expect(mockRememberCreateAppExternalAttribution).not.toHaveBeenCalled()
    },
  )

  it('persists attribution when analytics consent becomes granted', async () => {
    setAnalyticsConsent('unknown')
    setSearchParams('utm_source=dify_blog&slug=get-started-with-dify')
    render(<ExternalAttributionRecorder />)

    expect(getUtmInfoCookie()).toBeNull()
    expect(mockRememberCreateAppExternalAttribution).not.toHaveBeenCalled()

    act(() => setAnalyticsConsent('granted'))

    await waitFor(() => {
      expect(getUtmInfoCookie()).toEqual({
        utm_source: 'dify_blog',
        slug: 'get-started-with-dify',
      })
    })
    expect(mockRememberCreateAppExternalAttribution).toHaveBeenCalledTimes(1)
  })

  it('seeds the utm_info cookie and create_app attribution from the landing url', async () => {
    setSearchParams('utm_source=dify_blog&slug=get-started-with-dify')

    render(<ExternalAttributionRecorder />)

    await waitFor(() => {
      expect(getUtmInfoCookie()).toEqual({
        utm_source: 'dify_blog',
        slug: 'get-started-with-dify',
      })
    })
    expect(mockRememberCreateAppExternalAttribution).toHaveBeenCalledTimes(1)
    const firstArg = mockRememberCreateAppExternalAttribution.mock.calls[0]?.[0]
    expect(firstArg?.searchParams?.get('slug')).toBe('get-started-with-dify')
  })

  it('seeds attribution from the redirect_url when auth redirects away from the landing url', async () => {
    setSearchParams(
      `redirect_url=${encodeURIComponent('/apps?utm_source=dify_blog&slug=buildaisupportassistantwithdify')}`,
    )

    render(<ExternalAttributionRecorder />)

    await waitFor(() => {
      expect(getUtmInfoCookie()).toEqual({
        utm_source: 'dify_blog',
        slug: 'buildaisupportassistantwithdify',
      })
    })
    expect(mockRememberCreateAppExternalAttribution).toHaveBeenCalledTimes(1)
    const firstArg = mockRememberCreateAppExternalAttribution.mock.calls[0]?.[0]
    expect(firstArg?.searchParams?.get('utm_source')).toBe('dify_blog')
    expect(firstArg?.searchParams?.get('slug')).toBe('buildaisupportassistantwithdify')
  })

  it('does nothing without a utm_source', () => {
    setSearchParams('slug=get-started-with-dify')

    render(<ExternalAttributionRecorder />)

    expect(getUtmInfoCookie()).toBeNull()
    expect(mockRememberCreateAppExternalAttribution).not.toHaveBeenCalled()
  })

  it('does nothing for cross-origin redirect_url attribution params', () => {
    setSearchParams(
      `redirect_url=${encodeURIComponent('https://example.com/apps?utm_source=dify_blog&slug=get-started-with-dify')}`,
    )

    render(<ExternalAttributionRecorder />)

    expect(getUtmInfoCookie()).toBeNull()
    expect(mockRememberCreateAppExternalAttribution).not.toHaveBeenCalled()
  })

  it('overwrites a stale utm_info cookie with the latest campaign params', async () => {
    Cookies.set('utm_info', JSON.stringify({ utm_source: 'newsletter', slug: 'launch-week' }))
    setSearchParams('utm_source=dify_blog&slug=get-started-with-dify')

    render(<ExternalAttributionRecorder />)

    // The most recent blog click wins, so a stale cookie can't shadow the new slug.
    await waitFor(() => {
      expect(getUtmInfoCookie()).toEqual({
        utm_source: 'dify_blog',
        slug: 'get-started-with-dify',
      })
    })
    expect(mockRememberCreateAppExternalAttribution).toHaveBeenCalledTimes(1)
  })

  it('is a no-op outside the cloud edition', () => {
    mockConfig.IS_CLOUD_EDITION = false
    setSearchParams('utm_source=dify_blog&slug=get-started-with-dify')

    render(<ExternalAttributionRecorder />)

    expect(getUtmInfoCookie()).toBeNull()
    expect(mockRememberCreateAppExternalAttribution).not.toHaveBeenCalled()
  })
})
