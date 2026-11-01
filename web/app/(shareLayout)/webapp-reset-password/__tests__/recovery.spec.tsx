import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { COUNT_DOWN_KEY } from '@/app/components/signin/storage'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SigninCheckCode from '../../webapp-signin/check-code/page'
import CheckCode from '../check-code/page'
import ResetPassword from '../page'

const api = vi.hoisted(() => ({
  send: vi.fn(),
  verify: vi.fn(),
  resend: vi.fn(),
  login: vi.fn(),
  loginCode: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push, replace: api.replace }),
  useSearchParams: () =>
    new URLSearchParams({
      email: 'user@example.com',
      token: 'original-token',
      redirect_url: '/chatbot/test-app',
    }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'forgotPassword.post': api.send,
    }),
  }
})
vi.mock('@/service/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/common')>()),
  verifyWebAppResetPasswordCode: api.verify,
  sendWebAppResetPasswordCode: api.resend,
  webAppEmailLoginWithCode: api.login,
  sendWebAppEMailLoginCode: api.loginCode,
}))
beforeEach(() => {
  localStorage.setItem(COUNT_DOWN_KEY, '0')
  api.send.mockReset().mockResolvedValue({ result: 'success', data: 'email-token' })
  api.verify.mockReset().mockResolvedValue({ is_valid: true, token: 'verified-token' })
  api.resend.mockReset().mockResolvedValue({ result: 'success', data: 'new-token' })
})

it('keeps the email and shows the server reason when sending a reset code fails, then permits retry', async () => {
  const user = userEvent.setup()
  api.send.mockRejectedValueOnce(new Error('Email service unavailable'))
  render(<ResetPassword />)
  const email = screen.getByRole('textbox', { name: 'login.email' })
  await user.type(email, 'user@example.com')
  await user.click(screen.getByRole('button', { name: 'login.sendVerificationCode' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Email service unavailable')
  expect(email).toHaveValue('user@example.com')
  expect(api.push).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'login.sendVerificationCode' }))
  await waitFor(() => expect(api.push).toHaveBeenCalledOnce())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('retains the code after verification fails and navigates only after a successful retry', async () => {
  const user = userEvent.setup()
  api.verify.mockRejectedValueOnce(new Error('Code expired'))
  render(<CheckCode />)
  const code = screen.getByRole('textbox', { name: 'login.checkCode.verificationCode' })
  await user.type(code, '123456')
  await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Code expired')
  expect(code).toHaveValue('123456')
  expect(api.push).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))
  await waitFor(() => expect(api.push).toHaveBeenCalledOnce())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('shows a resend failure without changing the reset token', async () => {
  const user = userEvent.setup()
  api.resend.mockRejectedValueOnce(new Error('Too many requests'))
  render(<CheckCode />)
  await user.click(await screen.findByRole('button', { name: 'login.checkCode.resend' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests')
  expect(api.replace).not.toHaveBeenCalled()
})

it.each(['verify', 'resend'])(
  'shows the web-app sign-in %s failure without losing the code',
  async (action) => {
    const user = userEvent.setup()
    const command = action === 'verify' ? api.login : api.loginCode
    command.mockRejectedValueOnce(new Error('Sign-in service unavailable'))
    render(<SigninCheckCode />)
    const code = screen.getByRole('textbox', { name: 'login.checkCode.verificationCode' })
    await user.type(code, '123456')
    await user.click(await screen.findByRole('button', { name: `login.checkCode.${action}` }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in service unavailable')
    expect(code).toHaveValue('123456')
    expect(api.replace).not.toHaveBeenCalled()
  },
)
