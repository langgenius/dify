import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import MailAndPasswordAuth from '@/app/(shareLayout)/webapp-signin/components/mail-and-password-auth'
import CheckCode from '@/app/(shareLayout)/webapp-signin/check-code/page'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const replaceMock = jest.fn()
const backMock = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/chatbot/test-app'),
  useRouter: jest.fn(() => ({
    replace: replaceMock,
    back: backMock,
  })),
  useSearchParams: jest.fn(),
}))

const mockStoreState = {
  embeddedUserId: 'embedded-user-99',
  shareCode: 'test-app',
}

const useWebAppStoreMock = jest.fn((selector?: (state: typeof mockStoreState) => any) => {
  return selector ? selector(mockStoreState) : mockStoreState
})

jest.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector?: (state: typeof mockStoreState) => any) => useWebAppStoreMock(selector),
}))

const webAppLoginMock = jest.fn()
const webAppEmailLoginWithCodeMock = jest.fn()
const sendWebAppEMailLoginCodeMock = jest.fn()

jest.mock('@/service/common', () => ({
  webAppLogin: (...args: any[]) => webAppLoginMock(...args),
  webAppEmailLoginWithCode: (...args: any[]) => webAppEmailLoginWithCodeMock(...args),
  sendWebAppEMailLoginCode: (...args: any[]) => sendWebAppEMailLoginCodeMock(...args),
}))

const fetchAccessTokenMock = jest.fn()

jest.mock('@/service/share', () => ({
  fetchAccessToken: (...args: any[]) => fetchAccessTokenMock(...args),
}))

const setWebAppAccessTokenMock = jest.fn()
const setWebAppPassportMock = jest.fn()

jest.mock('@/service/webapp-auth', () => ({
  setWebAppAccessToken: (...args: any[]) => setWebAppAccessTokenMock(...args),
  setWebAppPassport: (...args: any[]) => setWebAppPassportMock(...args),
  webAppLogout: jest.fn(),
}))

jest.mock('@/app/components/signin/countdown', () => () => <div data-testid="countdown" />)

jest.mock('@remixicon/react', () => ({
  RiMailSendFill: () => <div data-testid="mail-icon" />,
  RiArrowLeftLine: () => <div data-testid="arrow-icon" />,
}))

const { useSearchParams } = jest.requireMock('next/navigation') as {
  useSearchParams: jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('embedded user id propagation in authentication flows', () => {
  it('passes embedded user id when logging in with email and password', async () => {
    const params = new URLSearchParams()
    params.set('redirect_url', encodeURIComponent('/chatbot/test-app'))
    useSearchParams.mockReturnValue(params)

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
    useSearchParams.mockReturnValue(params)

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
