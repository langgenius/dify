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

  it('initializes the email from the login link', () => {
    searchParams.set('email', 'linked@example.com')
    try {
      render(<MailAndPasswordAuth isEmailSetup />)
      expect(screen.getByRole('textbox', { name: 'login.email' })).toHaveValue('linked@example.com')
      expect(screen.getByRole('button', { name: 'login.signBtn' })).toBeEnabled()
    } finally {
      searchParams.delete('email')
    }
  })

  it('submits native autofill values without input events', async () => {
    const user = userEvent.setup()
    render(<MailAndPasswordAuth isEmailSetup />)
    const submit = screen.getByRole('button', { name: 'login.signBtn' })
    expect(submit).toBeEnabled()
    const email = screen.getByRole<HTMLInputElement>('textbox', { name: 'login.email' })
    const password = screen.getByLabelText<HTMLInputElement>('login.password', { exact: true })
    email.value = 'autofill@example.com'
    password.value = 'autofilled-password'
    await user.click(submit)
    await waitFor(() =>
      expect(webAppLoginMock).toHaveBeenCalledWith({
        url: '/login',
        body: {
          email: 'autofill@example.com',
          password: 'YXV0b2ZpbGxlZC1wYXNzd29yZA==',
          remember_me: true,
        },
      }),
    )
  })

  it.each([
    ['', 'valid-password', 'login.error.emailEmpty'],
    ['not-an-email', 'valid-password', 'login.error.emailInValid'],
    ['user@example.com', '', 'login.error.passwordEmpty'],
    ['user@example.com', '   ', 'login.error.passwordEmpty'],
  ])('validates credentials inline: %s / %s', async (email, password, error) => {
    const user = userEvent.setup()
    render(<MailAndPasswordAuth isEmailSetup />)
    if (email) await user.type(screen.getByRole('textbox', { name: 'login.email' }), email)
    if (password)
      await user.type(screen.getByLabelText('login.password', { exact: true }), password)
    await user.click(screen.getByRole('button', { name: 'login.signBtn' }))
    expect(await screen.findByText(error)).toBeVisible()
    expect(webAppLoginMock).not.toHaveBeenCalled()
  })

  it('preserves native autofilled values when toggling password visibility', async () => {
    const user = userEvent.setup()
    render(<MailAndPasswordAuth isEmailSetup />)
    const email = screen.getByRole<HTMLInputElement>('textbox', { name: 'login.email' })
    const password = screen.getByLabelText<HTMLInputElement>('login.password', { exact: true })
    email.value = 'autofill@example.com'
    password.value = 'autofilled-password'
    await user.click(screen.getByRole('button', { name: 'login.showPassword' }))
    expect(email).toHaveValue('autofill@example.com')
    expect(password).toHaveValue('autofilled-password')
    expect(webAppLoginMock).not.toHaveBeenCalled()
  })

  it('blocks repeated submission while login is pending and recovers after failure', async () => {
    const user = userEvent.setup()
    let rejectLogin!: (error: Error) => void
    webAppLoginMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectLogin = reject
      }),
    )
    render(<MailAndPasswordAuth isEmailSetup />)
    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')
    await user.type(screen.getByLabelText('login.password', { exact: true }), 'valid-password')
    const submit = screen.getByRole('button', { name: 'login.signBtn' })
    await user.click(submit)
    await waitFor(() => expect(submit).toHaveAttribute('aria-disabled', 'true'))
    await user.click(submit)
    expect(webAppLoginMock).toHaveBeenCalledTimes(1)
    rejectLogin(new Error('Login failed'))
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-disabled', 'true'))
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
