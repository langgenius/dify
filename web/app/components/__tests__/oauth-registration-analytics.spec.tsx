import { render, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchParams } from '@/next/navigation'
import { OAuthRegistrationAnalytics } from '../oauth-registration-analytics'

const { mockSendGAEvent, mockRememberRegistrationSuccess } = vi.hoisted(() => ({
  mockSendGAEvent: vi.fn(),
  mockRememberRegistrationSuccess: vi.fn(),
}))

vi.mock('@/utils/gtag', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('../base/amplitude/registration-tracking', () => ({
  rememberRegistrationSuccess: (...args: unknown[]) => mockRememberRegistrationSuccess(...args),
}))

const mockUseSearchParams = vi.mocked(useSearchParams)

const setSearchParams = (searchParams = '') => {
  mockUseSearchParams.mockReturnValue(new URLSearchParams(searchParams) as unknown as ReturnType<typeof useSearchParams>)
  window.history.replaceState(null, '', `/signin${searchParams ? `?${searchParams}` : ''}`)
}

describe('OAuthRegistrationAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Cookies.remove('utm_info')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSearchParams()
  })

  it('should track oauth registration with utm info and clear the query flag', async () => {
    Cookies.set('utm_info', JSON.stringify({
      utm_source: 'linkedin',
      slug: 'agent-launch',
    }))

    setSearchParams('oauth_new_user=true&source=signin')
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

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

    await waitFor(() => {
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/signin?source=signin')
    })
  })

  it('should fall back to the base registration event when the utm cookie is invalid', async () => {
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

  it('should do nothing without the oauth registration query flag', () => {
    render(<OAuthRegistrationAnalytics />)

    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })

  it('should clear a false oauth registration query flag without tracking', async () => {
    setSearchParams('oauth_new_user=false')
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

    render(<OAuthRegistrationAnalytics />)

    await waitFor(() => {
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/signin')
    })
    expect(mockRememberRegistrationSuccess).not.toHaveBeenCalled()
    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })
})
