import { waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { OAuthRegistrationAnalytics } from '../oauth-registration-analytics'

const { mockSendGAEvent, mockTrackEvent } = vi.hoisted(() => ({
  mockSendGAEvent: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/utils/gtag', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

vi.mock('../base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

describe('OAuthRegistrationAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Cookies.remove('utm_info')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('should track oauth registration with utm info and clear the query flag', async () => {
    Cookies.set('utm_info', JSON.stringify({
      utm_source: 'linkedin',
      slug: 'agent-launch',
    }))

    const { onUrlUpdate } = renderWithNuqs(<OAuthRegistrationAnalytics />, {
      searchParams: 'oauth_new_user=true&source=signin',
    })

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
        method: 'oauth',
        utm_source: 'linkedin',
        slug: 'agent-launch',
      })
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
      method: 'oauth',
      utm_source: 'linkedin',
      slug: 'agent-launch',
    })
    expect(Cookies.get('utm_info')).toBeUndefined()

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
    expect(update.searchParams.has('oauth_new_user')).toBe(false)
    expect(update.searchParams.get('source')).toBe('signin')
    expect(update.options.history).toBe('replace')
  })

  it('should fall back to the base registration event when the utm cookie is invalid', async () => {
    Cookies.set('utm_info', '{invalid-json')

    renderWithNuqs(<OAuthRegistrationAnalytics />, {
      searchParams: 'oauth_new_user=true',
    })

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith('user_registration_success', {
        method: 'oauth',
      })
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success', {
      method: 'oauth',
    })
    expect(console.error).toHaveBeenCalled()
    expect(Cookies.get('utm_info')).toBeUndefined()
  })

  it('should do nothing without the oauth registration query flag', () => {
    renderWithNuqs(<OAuthRegistrationAnalytics />)

    expect(mockTrackEvent).not.toHaveBeenCalled()
    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })

  it('should clear a false oauth registration query flag without tracking', async () => {
    const { onUrlUpdate } = renderWithNuqs(<OAuthRegistrationAnalytics />, {
      searchParams: 'oauth_new_user=false',
    })

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(mockTrackEvent).not.toHaveBeenCalled()
    expect(mockSendGAEvent).not.toHaveBeenCalled()
  })
})
