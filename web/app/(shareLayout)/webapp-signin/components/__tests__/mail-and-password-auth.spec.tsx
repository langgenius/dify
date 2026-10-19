import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MailAndPasswordAuth from '../mail-and-password-auth'

const replaceMock = vi.fn()
const webAppLoginMock = vi.fn()
const fetchAccessTokenMock = vi.fn()
const searchParams = new URLSearchParams({
  redirect_url: encodeURIComponent('/chatbot/test-app'),
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => searchParams,
}))

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: { embeddedUserId: string }) => unknown) =>
    selector({ embeddedUserId: 'embedded-user-99' }),
}))

vi.mock('@/service/common', () => ({
  webAppLogin: (...args: unknown[]) => webAppLoginMock(...args),
}))

vi.mock('@/service/share', () => ({
  fetchAccessToken: (...args: unknown[]) => fetchAccessTokenMock(...args),
}))

describe('MailAndPasswordAuth', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    webAppLoginMock.mockResolvedValue({
      result: 'success',
      data: { access_token: 'login-token' },
    })
    fetchAccessTokenMock.mockResolvedValue({ access_token: 'passport-token' })
  })

  afterEach(() => localStorage.clear())

  it('submits from the password field through the native form', async () => {
    const user = userEvent.setup()
    render(<MailAndPasswordAuth isEmailSetup />)

    const emailInput = screen.getByRole('textbox', { name: 'login.email' })
    const passwordInput = screen.getByLabelText('login.password', { exact: true })
    const submitButton = screen.getByRole('button', { name: 'login.signBtn' })

    expect(emailInput).toHaveAttribute('name', 'email')
    expect(emailInput).toHaveAttribute('autocomplete', 'email')
    expect(passwordInput).toHaveAttribute('name', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')
    expect(submitButton).toHaveAttribute('type', 'submit')

    await user.tab()
    expect(emailInput).toHaveFocus()
    await user.type(emailInput, 'user@example.com')
    await user.tab()
    expect(screen.getByRole('link', { name: 'login.forget' })).toHaveFocus()
    await user.tab()
    expect(passwordInput).toHaveFocus()
    await user.type(passwordInput, 'strong-password{Enter}')

    await waitFor(() => {
      expect(webAppLoginMock).toHaveBeenCalledWith({
        url: '/login',
        body: {
          email: 'user@example.com',
          password: 'c3Ryb25nLXBhc3N3b3Jk',
          remember_me: true,
        },
      })
    })
  })

  it('names the password visibility action for its current state', async () => {
    const user = userEvent.setup()
    render(<MailAndPasswordAuth isEmailSetup />)

    const passwordInput = screen.getByLabelText('login.password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'login.showPassword' }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'login.hidePassword' }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })
})
