import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'

import CheckCode from '@/app/(shareLayout)/webapp-signin/check-code/page'
import MailAndPasswordAuth from '@/app/(shareLayout)/webapp-signin/components/mail-and-password-auth'

const replaceMock = vi.fn()
const backMock = vi.fn()
const useSearchParamsMock = vi.fn(() => new URLSearchParams())

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/chatbot/test-app'),
  useRouter: vi.fn(() => ({
    replace: replaceMock,
    back: backMock,
  })),
  useSearchParams: () => useSearchParamsMock(),
}))

const mockStoreState = {
  embeddedUserId: 'embedded-user-99',
  shareCode: 'test-app',
}

const useWebAppStoreMock = vi.fn((selector?: (state: typeof mockStoreState) => any) => {
  return selector ? selector(mockStoreState) : mockStoreState
})

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector?: (state: typeof mockStoreState) => any) => useWebAppStoreMock(selector),
}))

const webAppLoginMock = vi.fn()
const webAppEmailLoginWithCodeMock = vi.fn()
const sendWebAppEMailLoginCodeMock = vi.fn()

vi.mock('@/service/common', () => ({
  webAppLogin: (...args: any[]) => webAppLoginMock(...args),
  webAppEmailLoginWithCode: (...args: any[]) => webAppEmailLoginWithCodeMock(...args),
  sendWebAppEMailLoginCode: (...args: any[]) => sendWebAppEMailLoginCodeMock(...args),
}))

const fetchAccessTokenMock = vi.fn()

vi.mock('@/service/share', () => ({
  fetchAccessToken: (...args: any[]) => fetchAccessTokenMock(...args),
}))

const setWebAppAccessTokenMock = vi.fn()
const setWebAppPassportMock = vi.fn()

vi.mock('@/service/webapp-auth', () => ({
  setWebAppAccessToken: (...args: any[]) => setWebAppAccessTokenMock(...args),
  setWebAppPassport: (...args: any[]) => setWebAppPassportMock(...args),
  webAppLogout: vi.fn(),
}))

vi.mock('@/app/components/signin/countdown', () => ({ default: () => <div data-testid="countdown" /> }))

vi.mock('@remixicon/react', () => ({
  RiMailSendFill: () => <div data-testid="mail-icon" />,
  RiArrowLeftLine: () => <div data-testid="arrow-icon" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('embedded user id propagation in authentication flows', () => {
  it('passes embedded user id when logging in with email and password', async () => {
    const params = new URLSearchParams()
    params.set('redirect_url', encodeURIComponent('/chatbot/test-app'))
    useSearchParamsMock.mockReturnValue(params)

    webAppLoginMock.mockResolvedValue({ result: 'success', data: { access_token: 'login-token' } })
    fetchAccessTokenMock.mockResolvedValue({ access_token: 'passport-token' })

    render(<MailAndPasswordAuth isEmailSetup />)

    fireEvent.change(screen.getByLabelText('login.email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText(/login\.password/), { target: { value: 'strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'login.signBtn' }))

    await waitFor(() => {
      expect(fetchAccessTokenMock).toHaveBeenCalledWith({
        appCode: 'test-app',
        userId: 'embedded-user-99',
      })
    })
    expect(setWebAppAccessTokenMock).toHaveBeenCalledWith('login-token')
    expect(setWebAppPassportMock).toHaveBeenCalledWith('test-app', 'passport-token')
    expect(replaceMock).toHaveBeenCalledWith('/chatbot/test-app')
  })

  it('passes embedded user id when verifying email code', async () => {
    const params = new URLSearchParams()
    params.set('redirect_url', encodeURIComponent('/chatbot/test-app'))
    params.set('email', encodeURIComponent('user@example.com'))
    params.set('token', encodeURIComponent('token-abc'))
    useSearchParamsMock.mockReturnValue(params)

    webAppEmailLoginWithCodeMock.mockResolvedValue({ result: 'success', data: { access_token: 'code-token' } })
    fetchAccessTokenMock.mockResolvedValue({ access_token: 'passport-token' })

    render(<CheckCode />)

    fireEvent.change(
      screen.getByPlaceholderText('login.checkCode.verificationCodePlaceholder'),
      { target: { value: '123456' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

    await waitFor(() => {
      expect(fetchAccessTokenMock).toHaveBeenCalledWith({
        appCode: 'test-app',
        userId: 'embedded-user-99',
      })
    })
    expect(setWebAppAccessTokenMock).toHaveBeenCalledWith('code-token')
    expect(setWebAppPassportMock).toHaveBeenCalledWith('test-app', 'passport-token')
    expect(replaceMock).toHaveBeenCalledWith('/chatbot/test-app')
  })
})
