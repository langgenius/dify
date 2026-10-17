import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import CheckCode from '@/app/(shareLayout)/webapp-signin/check-code/page'
import MailAndCodeAuth from '@/app/(shareLayout)/webapp-signin/components/mail-and-code-auth'
import MailAndPasswordAuth from '@/app/(shareLayout)/webapp-signin/components/mail-and-password-auth'
import { useWebAppStore } from '@/context/web-app-context'

const replaceMock = vi.fn()
const backMock = vi.fn()
const useSearchParamsMock = vi.fn(() => new URLSearchParams())

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(() => '/chatbot/test-app'),
  useRouter: vi.fn(() => ({
    replace: replaceMock,
    back: backMock,
  })),
  useSearchParams: () => useSearchParamsMock(),
}))

const webAppLoginMock = vi.fn()
const webAppEmailLoginWithCodeMock = vi.fn()
const sendWebAppEMailLoginCodeMock = vi.fn()

vi.mock('@/service/common', () => ({
  webAppLogin: (...args: unknown[]) => webAppLoginMock(...args),
  webAppEmailLoginWithCode: (...args: unknown[]) => webAppEmailLoginWithCodeMock(...args),
  sendWebAppEMailLoginCode: (...args: unknown[]) => sendWebAppEMailLoginCodeMock(...args),
}))

const fetchAccessTokenMock = vi.fn()

vi.mock('@/service/share', () => ({
  fetchAccessToken: (...args: unknown[]) => fetchAccessTokenMock(...args),
}))

const setWebAppAccessTokenMock = vi.fn()
const setWebAppPassportMock = vi.fn()

vi.mock('@/service/webapp-auth', () => ({
  setWebAppAccessToken: (...args: unknown[]) => setWebAppAccessTokenMock(...args),
  setWebAppPassport: (...args: unknown[]) => setWebAppPassportMock(...args),
  webAppLogout: vi.fn(),
}))

vi.mock('@/app/components/signin/countdown', () => ({
  default: () => <div data-testid="countdown" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  useWebAppStore.setState({ embeddedUserId: 'embedded-user-99', shareCode: 'test-app' })
})

describe('embedded user id propagation in authentication flows', () => {
  it('passes embedded user id when logging in with email and password', async () => {
    const user = userEvent.setup()
    const params = new URLSearchParams()
    params.set('redirect_url', encodeURIComponent('/chatbot/test-app'))
    useSearchParamsMock.mockReturnValue(params)

    webAppLoginMock.mockResolvedValue({ result: 'success', data: { access_token: 'login-token' } })
    fetchAccessTokenMock.mockResolvedValue({ access_token: 'passport-token' })

    render(<MailAndPasswordAuth isEmailSetup />)

    await user.type(screen.getByLabelText('login.email'), 'user@example.com')
    await user.type(screen.getByLabelText(/login\.password/), 'strong-password')
    await user.click(screen.getByRole('button', { name: 'login.signBtn' }))

    await waitFor(() => {
      expect(fetchAccessTokenMock).toHaveBeenCalledWith({
        appCode: 'test-app',
        userId: 'embedded-user-99',
      })
    })
    expect(setWebAppAccessTokenMock).toHaveBeenCalledWith('login-token')
    expect(setWebAppPassportMock).toHaveBeenCalledWith(
      { kind: 'default', code: 'test-app' },
      'passport-token',
    )
    expect(replaceMock).toHaveBeenCalledWith('/chatbot/test-app')
  })

  it('does not call password login services when the redirect target is external', async () => {
    const user = userEvent.setup()
    const params = new URLSearchParams()
    params.set('redirect_url', 'https://evil.example/chatbot/evil-app')
    useSearchParamsMock.mockReturnValue(params)

    render(<MailAndPasswordAuth isEmailSetup />)

    await user.type(screen.getByLabelText('login.email'), 'user@example.com')
    await user.type(screen.getByLabelText(/login\.password/), 'strong-password')
    await user.click(screen.getByRole('button', { name: 'login.signBtn' }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/')
    })
    expect(webAppLoginMock).not.toHaveBeenCalled()
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
  })

  it('does not request an email code when the redirect target is external', async () => {
    const user = userEvent.setup()
    const params = new URLSearchParams()
    params.set('redirect_url', 'https://evil.example/chatbot/evil-app')
    useSearchParamsMock.mockReturnValue(params)

    render(<MailAndCodeAuth />)

    await user.type(screen.getByLabelText('login.email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: 'login.signup.verifyMail' }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/')
    })
    expect(sendWebAppEMailLoginCodeMock).not.toHaveBeenCalled()
  })

  it('passes embedded user id when verifying email code', async () => {
    const user = userEvent.setup()
    const params = new URLSearchParams()
    params.set('redirect_url', encodeURIComponent('/chatbot/test-app'))
    params.set('email', encodeURIComponent('user@example.com'))
    params.set('token', encodeURIComponent('token-abc'))
    useSearchParamsMock.mockReturnValue(params)

    webAppEmailLoginWithCodeMock.mockResolvedValue({
      result: 'success',
      data: { access_token: 'code-token' },
    })
    fetchAccessTokenMock.mockResolvedValue({ access_token: 'passport-token' })

    render(<CheckCode />)

    await user.type(
      screen.getByPlaceholderText('login.checkCode.verificationCodePlaceholder'),
      '123456',
    )
    await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

    await waitFor(() => {
      expect(fetchAccessTokenMock).toHaveBeenCalledWith({
        appCode: 'test-app',
        userId: 'embedded-user-99',
      })
    })
    expect(setWebAppAccessTokenMock).toHaveBeenCalledWith('code-token')
    expect(setWebAppPassportMock).toHaveBeenCalledWith(
      { kind: 'default', code: 'test-app' },
      'passport-token',
    )
    expect(replaceMock).toHaveBeenCalledWith('/chatbot/test-app')
  })

  it('does not call code login services when the redirect target is external', async () => {
    const user = userEvent.setup()
    const params = new URLSearchParams()
    params.set('redirect_url', 'https://evil.example/chatbot/evil-app')
    params.set('email', encodeURIComponent('user@example.com'))
    params.set('token', encodeURIComponent('token-abc'))
    useSearchParamsMock.mockReturnValue(params)

    render(<CheckCode />)

    await user.type(
      screen.getByPlaceholderText('login.checkCode.verificationCodePlaceholder'),
      '123456',
    )
    await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/')
    })
    expect(webAppEmailLoginWithCodeMock).not.toHaveBeenCalled()
    expect(fetchAccessTokenMock).not.toHaveBeenCalled()
  })
})
