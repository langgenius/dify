import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MailAndCodeAuth from '../mail-and-code-auth'

const pushMock = vi.fn()
const replaceMock = vi.fn()
const setCountdownLeftTimeMock = vi.fn()
const sendWebAppEMailLoginCodeMock = vi.fn()
const searchParams = new URLSearchParams({
  redirect_url: encodeURIComponent('/chatbot/test-app'),
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParams,
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/app/components/signin/storage', () => ({
  COUNT_DOWN_TIME_MS: 60_000,
  useSetCountdownLeftTime: () => setCountdownLeftTimeMock,
}))

vi.mock('@/service/common', () => ({
  sendWebAppEMailLoginCode: (...args: unknown[]) => sendWebAppEMailLoginCodeMock(...args),
}))

describe('MailAndCodeAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendWebAppEMailLoginCodeMock.mockResolvedValue({ result: 'success', data: 'token-abc' })
  })

  it('submits from the email field through the native form', async () => {
    const user = userEvent.setup()
    render(<MailAndCodeAuth />)

    const emailInput = screen.getByRole('textbox', { name: 'login.email' })
    const submitButton = screen.getByRole('button', { name: 'login.signup.verifyMail' })

    expect(emailInput).toHaveAttribute('name', 'email')
    expect(emailInput).toHaveAttribute('autocomplete', 'email')
    expect(emailInput).toHaveAttribute('spellcheck', 'false')
    expect(submitButton).toHaveAttribute('type', 'submit')

    await user.tab()
    expect(emailInput).toHaveFocus()
    await user.type(emailInput, 'user@example.com{Enter}')

    await waitFor(() => {
      expect(sendWebAppEMailLoginCodeMock).toHaveBeenCalledTimes(1)
    })
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/webapp-signin/check-code?'))
  })
})
