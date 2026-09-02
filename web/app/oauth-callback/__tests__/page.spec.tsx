import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactI18nextMock } from '@/test/i18n-mock'

vi.mock('react-i18next', () =>
  createReactI18nextMock({
    'oauth.callback.success': 'Authorization complete',
    'oauth.callback.successHint': 'You can now close this tab and return to the previous page.',
    'oauth.callback.error': 'Authorization failed',
    'oauth.callback.errorHint': 'Please return to the previous page and try again.',
    'login.signBtn': 'Sign in',
  }),
)

vi.mock('@/hooks/use-oauth', () => ({
  useOAuthCallback: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const { useOAuthCallback } = await import('@/hooks/use-oauth')
const OAuthCallback = (await import('../page')).default

const setOpener = (opener: Window | null) => {
  Object.defineProperty(window, 'opener', { configurable: true, writable: true, value: opener })
}

describe('OAuthCallback page', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    setOpener(null)
  })

  it('renders an empty <div /> when opened as a popup (hasOpener=true) so the popup can close cleanly', () => {
    setOpener({ postMessage: vi.fn() } as unknown as Window)
    vi.mocked(useOAuthCallback).mockReturnValue({
      hasOpener: true,
      finished: false,
      error: null,
      errorDescription: null,
    })

    const { container } = render(<OAuthCallback />)
    expect(container.firstChild).not.toBeNull()
    expect(container.firstChild!.nodeName).toBe('DIV')
    expect(container.firstChild!.childNodes.length).toBe(0)
  })

  it('renders a success message when opened in a new tab with a subscription_id (#39752)', () => {
    setOpener(null)
    vi.mocked(useOAuthCallback).mockReturnValue({
      hasOpener: false,
      finished: true,
      error: null,
      errorDescription: null,
    })

    render(<OAuthCallback />)
    expect(screen.getByText('Authorization complete')).toBeInTheDocument()
    expect(
      screen.getByText('You can now close this tab and return to the previous page.'),
    ).toBeInTheDocument()
  })

  it('renders an error message with the provider description when the provider reported an error (#39752)', () => {
    setOpener(null)
    vi.mocked(useOAuthCallback).mockReturnValue({
      hasOpener: false,
      finished: true,
      error: 'access_denied',
      errorDescription: 'Please re-authorize the app.',
    })

    render(<OAuthCallback />)
    expect(screen.getByText('Authorization failed')).toBeInTheDocument()
    expect(screen.getByText('Please re-authorize the app.')).toBeInTheDocument()
  })

  it('falls back to a generic error hint when the provider did not supply an error_description', () => {
    setOpener(null)
    vi.mocked(useOAuthCallback).mockReturnValue({
      hasOpener: false,
      finished: true,
      error: 'server_error',
      errorDescription: null,
    })

    render(<OAuthCallback />)
    expect(screen.getByText('Authorization failed')).toBeInTheDocument()
    expect(
      screen.getByText('Please return to the previous page and try again.'),
    ).toBeInTheDocument()
  })
})
