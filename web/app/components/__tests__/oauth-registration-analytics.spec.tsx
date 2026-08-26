import { render, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useSearchParams } from '@/next/navigation'
import { OAuthRegistrationAnalytics } from '../oauth-registration-analytics'

const {
  mockConsent,
  mockNormalizeRegistrationAttribution,
  mockRememberRegistrationSuccess,
  mockSendGAEvent,
} = vi.hoisted(() => ({
  mockConsent: { value: 'granted' as 'unknown' | 'denied' | 'granted' | 'disabled' },
  mockNormalizeRegistrationAttribution: vi.fn((value: Record<string, unknown> | null) => {
    if (!value) return null
    const allowed = Object.fromEntries(
      Object.entries(value).filter(
        ([key, item]) =>
          ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'slug'].includes(
            key,
          ) && typeof item === 'string',
      ),
    )
    return Object.keys(allowed).length ? allowed : null
  }),
  mockRememberRegistrationSuccess: vi.fn(),
  mockSendGAEvent: vi.fn(),
}))

vi.mock('@/utils/gtag', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('../base/analytics-consent/consent-store', () => ({
  useAnalyticsConsent: () => mockConsent.value,
}))

vi.mock('../base/amplitude/registration-tracking', () => ({
  normalizeRegistrationAttribution: (
    ...args: Parameters<typeof mockNormalizeRegistrationAttribution>
  ) => mockNormalizeRegistrationAttribution(...args),
  rememberRegistrationSuccess: (...args: unknown[]) => mockRememberRegistrationSuccess(...args),
}))

const mockUseSearchParams = vi.mocked(useSearchParams)

const setSearchParams = (searchParams = '') => {
  mockUseSearchParams.mockReturnValue(
    new URLSearchParams(searchParams) as unknown as ReturnType<typeof useSearchParams>,
  )
  window.history.replaceState(null, '', `/signin${searchParams ? `?${searchParams}` : ''}`)
}

describe('OAuthRegistrationAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    mockConsent.value = 'granted'
    mockRememberRegistrationSuccess.mockReturnValue(true)
    Cookies.remove('utm_info')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSearchParams()
  })

  it('keeps the OAuth marker and UTM cookie while consent is unknown, then queues and cleans on grant', async () => {
    mockConsent.value = 'unknown'
    Cookies.set('utm_info', JSON.stringify({ utm_source: 'linkedin', slug: 'agent-launch' }))
    setSearchParams('oauth_new_user=true&source=signin')

    const { rerender } = render(<OAuthRegistrationAnalytics />)

    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(mockSendGAEvent).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?oauth_new_user=true&source=signin')
    expect(Cookies.get('utm_info')).toBeTruthy()

    mockConsent.value = 'granted'
    rerender(<OAuthRegistrationAnalytics />)

    await waitFor(() => {
      expect(mockRememberRegistrationSuccess).toHaveBeenCalledWith({
        method: 'oauth',
        utmInfo: { utm_source: 'linkedin', slug: 'agent-launch' },
      })
    })
    expect(mockSendGAEvent).toHaveBeenCalledTimes(1)
    expect(Cookies.get('utm_info')).toBeUndefined()
    expect(window.location.search).toBe('?source=signin')
  })

  it('keeps the recoverable OAuth signal when marker persistence fails', () => {
    Cookies.set('utm_info', JSON.stringify({ utm_source: 'linkedin' }))
    setSearchParams('oauth_new_user=true&source=signin')
    mockRememberRegistrationSuccess.mockReturnValue(false)

    render(<OAuthRegistrationAnalytics />)

    expect(mockRememberRegistrationSuccess).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?oauth_new_user=true&source=signin')
    expect(Cookies.get('utm_info')).toBeTruthy()
  })

  it('keeps the OAuth marker while consent is unknown, then cleans without Amplitude on denial', async () => {
    mockConsent.value = 'unknown'
    Cookies.set('utm_info', JSON.stringify({ utm_source: 'blog' }))
    setSearchParams('oauth_new_user=true')

    const { rerender } = render(<OAuthRegistrationAnalytics />)

    expect(mockSendGAEvent).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?oauth_new_user=true')

    mockConsent.value = 'denied'
    rerender(<OAuthRegistrationAnalytics />)

    await waitFor(() => expect(window.location.search).toBe(''))
    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(mockSendGAEvent).toHaveBeenCalledTimes(1)
    expect(Cookies.get('utm_info')).toBeUndefined()
  })

  it('queues immediately with pre-granted consent and keeps only allowlisted UTM fields', async () => {
    Cookies.set(
      'utm_info',
      JSON.stringify({
        utm_source: 'linkedin',
        slug: 'agent-launch',
        arbitrary: 'discard-me',
        utm_term: { nested: true },
      }),
    )
    setSearchParams('oauth_new_user=true&source=signin')

    render(<OAuthRegistrationAnalytics />)

    await waitFor(() => {
      expect(mockRememberRegistrationSuccess).toHaveBeenCalledWith({
        method: 'oauth',
        utmInfo: { utm_source: 'linkedin', slug: 'agent-launch' },
      })
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
      method: 'oauth',
      utm_source: 'linkedin',
      slug: 'agent-launch',
    })
    expect(Cookies.get('utm_info')).toBeUndefined()
    expect(window.location.search).toBe('?source=signin')
  })

  it('uses the base event and cleans up when the UTM cookie is malformed', async () => {
    Cookies.set('utm_info', '{invalid-json')
    setSearchParams('oauth_new_user=true')

    render(<OAuthRegistrationAnalytics />)

    await waitFor(() => {
      expect(mockRememberRegistrationSuccess).toHaveBeenCalledWith({
        method: 'oauth',
        utmInfo: null,
      })
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success', {
      method: 'oauth',
    })
    expect(console.error).toHaveBeenCalled()
    expect(Cookies.get('utm_info')).toBeUndefined()
  })

  it('cleans a false OAuth marker immediately without tracking', async () => {
    mockConsent.value = 'unknown'
    Cookies.set('utm_info', JSON.stringify({ utm_source: 'blog' }))
    setSearchParams('oauth_new_user=false')

    render(<OAuthRegistrationAnalytics />)

    await waitFor(() => expect(window.location.search).toBe(''))
    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(mockSendGAEvent).not.toHaveBeenCalled()
    expect(Cookies.get('utm_info')).toBeUndefined()
  })

  it('tracks GA and Amplitude once across StrictMode effects and rerenders', async () => {
    setSearchParams('oauth_new_user=true')

    const { rerender } = render(
      <StrictMode>
        <OAuthRegistrationAnalytics />
      </StrictMode>,
    )

    rerender(
      <StrictMode>
        <OAuthRegistrationAnalytics />
      </StrictMode>,
    )

    await waitFor(() => expect(mockRememberRegistrationSuccess).toHaveBeenCalledTimes(1))
    expect(mockSendGAEvent).toHaveBeenCalledTimes(1)
  })

  it('tracks GA once across an unknown-consent remount that simulates reload', () => {
    mockConsent.value = 'unknown'
    setSearchParams('oauth_new_user=true')

    const firstRender = render(<OAuthRegistrationAnalytics />)
    firstRender.unmount()
    render(<OAuthRegistrationAnalytics />)

    expect(mockSendGAEvent).toHaveBeenCalledTimes(1)
    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?oauth_new_user=true')
  })

  it('treats analytics-disabled consent as terminal and cleans without Amplitude', async () => {
    mockConsent.value = 'disabled'
    Cookies.set('utm_info', JSON.stringify({ utm_source: 'blog' }))
    setSearchParams('oauth_new_user=true')

    render(<OAuthRegistrationAnalytics />)

    await waitFor(() => expect(window.location.search).toBe(''))
    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(Cookies.get('utm_info')).toBeUndefined()
  })

  it('does nothing without the OAuth registration query marker', () => {
    render(<OAuthRegistrationAnalytics />)

    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })
})
