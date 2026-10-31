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

vi.mock('@/app/components/signin/storage', () => ({
  COUNT_DOWN_TIME_MS: 60_000,
  useSetCountdownLeftTime: () => setCountdownLeftTimeMock,
}))

vi.mock('@/service/common', () => ({
  sendWebAppEMailLoginCode: (...args: unknown[]) => sendWebAppEMailLoginCodeMock(...args),
}))

describe('MailAndCodeAuth', () => {
  beforeEach(() => {
    sendWebAppEMailLoginCodeMock
      .mockReset()
      .mockResolvedValue({ result: 'success', data: 'token-abc' })
  })

  it('submits from the email field through the native form', async () => {
    const user = userEvent.setup()
    render(<MailAndCodeAuth />)

    const emailInput = screen.getByRole('textbox', { name: 'login.email' })

    await user.type(emailInput, 'user@example.com{Enter}')

    await waitFor(() => {
      expect(sendWebAppEMailLoginCodeMock).toHaveBeenCalledTimes(1)
    })
    expect(sendWebAppEMailLoginCodeMock).toHaveBeenCalledWith('user@example.com', 'en-US')
    expect(setCountdownLeftTimeMock).toHaveBeenCalledWith('60000')
    const destination = new URL(pushMock.mock.calls[0]![0], window.location.origin)
    expect(destination.pathname).toBe('/webapp-signin/check-code')
    expect(decodeURIComponent(destination.searchParams.get('email')!)).toBe('user@example.com')
    expect(destination.searchParams.get('token')).toBe('token-abc')
    expect(destination.searchParams.get('redirect_url')).toBe('/chatbot/test-app')
  })
  it('reports a code-delivery failure and keeps the email available for retry', async () => {
    const user = userEvent.setup()
    sendWebAppEMailLoginCodeMock.mockRejectedValueOnce(new Error('Email delivery unavailable'))
    render(<MailAndCodeAuth />)
    const email = screen.getByRole('textbox', { name: 'login.email' })
    await user.type(email, 'user@example.com{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Email delivery unavailable')
    expect(email).toHaveValue('user@example.com')
    expect(pushMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'login.signup.verifyMail' }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
