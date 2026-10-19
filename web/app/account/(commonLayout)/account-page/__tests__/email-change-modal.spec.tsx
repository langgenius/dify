import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import EmailChangeModal from '../email-change-modal'

const mockLogout = vi.fn()

vi.mock('@/app/notifications', () => ({
  toast: { error: vi.fn() },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'account.changeEmail.checkEmailUnique.post': vi.fn(),
      'account.changeEmail.reset.post': vi.fn(),
      'account.changeEmail.post': vi.fn(),
      'account.changeEmail.validity.post': vi.fn(),
    }),
  }
})

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: mockLogout }),
}))

describe('EmailChangeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(consoleClient.account.changeEmail.post).mockResolvedValue({
      result: 'success',
      data: 'email-token',
    })
    vi.mocked(consoleClient.account.changeEmail.validity.post).mockResolvedValue({
      email: 'old@example.com',
      is_valid: true,
      token: 'verified-token',
    })
    vi.mocked(consoleClient.account.changeEmail.checkEmailUnique.post).mockResolvedValue({
      result: 'success',
    })
  })

  it('submits the labeled verification fields with Enter through both email phases', async () => {
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" onClose={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )
    const originCode = await screen.findByRole('textbox', {
      name: 'accountSettings.account.changeEmail.codeLabel',
    })
    await user.type(originCode, '123456{Enter}')
    expect(consoleClient.account.changeEmail.validity.post).toHaveBeenCalledWith({
      body: {
        email: 'old@example.com',
        code: '123456',
        token: 'email-token',
      },
    })

    const email = await screen.findByRole('textbox', {
      name: 'accountSettings.account.changeEmail.emailLabel',
    })
    await user.type(email, 'new@example.com')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
      ).toBeEnabled(),
    )
    await user.type(email, '{Enter}')
    expect(consoleClient.account.changeEmail.post).toHaveBeenLastCalledWith({
      body: {
        email: 'new@example.com',
        phase: 'new_email',
        token: 'verified-token',
      },
    })

    const newCode = await screen.findByRole('textbox', {
      name: 'accountSettings.account.changeEmail.codeLabel',
    })
    expect(newCode).toHaveValue('')
    await user.type(newCode, '654321{Enter}')
    await waitFor(() =>
      expect(consoleClient.account.changeEmail.reset.post).toHaveBeenCalledWith({
        body: {
          new_email: 'new@example.com',
          token: 'verified-token',
        },
      }),
    )
    expect(mockLogout).toHaveBeenCalledOnce()
  })

  it('associates an unavailable-email error and clears it when the user edits the address', async () => {
    vi.mocked(consoleClient.account.changeEmail.checkEmailUnique.post).mockRejectedValue(
      createHttpError(new Response(null, { status: 400 }), { code: 'email_already_in_use' }),
    )
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" onClose={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )
    await user.type(
      await screen.findByRole('textbox', { name: 'accountSettings.account.changeEmail.codeLabel' }),
      '123456{Enter}',
    )
    const email = await screen.findByRole('textbox', {
      name: 'accountSettings.account.changeEmail.emailLabel',
    })
    await user.type(email, 'used@example.com')

    await screen.findByText('accountSettings.account.changeEmail.existingEmail')
    expect(email).toBeInvalid()
    expect(email).toHaveAccessibleDescription('accountSettings.account.changeEmail.existingEmail')
    await user.clear(email)
    expect(email).not.toBeInvalid()
    expect(
      screen.queryByText('accountSettings.account.changeEmail.existingEmail'),
    ).not.toBeInTheDocument()
  })

  it('shows the server message when sending a verification code fails', async () => {
    vi.mocked(consoleClient.account.changeEmail.post).mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 429 }), {
        code: 'rate_limit_exceeded',
        message: 'Try again in one minute',
      }),
    )
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" onClose={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Error sending verification code: Try again in one minute',
      ),
    )
    expect(consoleClient.account.changeEmail.validity.post).not.toHaveBeenCalled()
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('preserves the verification step after an HTTP error and allows another attempt', async () => {
    vi.mocked(consoleClient.account.changeEmail.validity.post).mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 400 }), {
        code: 'invalid_code',
        message: 'Verification code has expired',
      }),
    )
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" onClose={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )
    const originCode = await screen.findByRole('textbox', {
      name: 'accountSettings.account.changeEmail.codeLabel',
    })
    await user.type(originCode, '123456{Enter}')

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Error verifying email: Verification code has expired',
      ),
    )
    expect(originCode).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: 'accountSettings.account.changeEmail.emailLabel' }),
    ).not.toBeInTheDocument()
    expect(consoleClient.account.changeEmail.reset.post).not.toHaveBeenCalled()

    await user.type(originCode, '654321{Enter}')

    expect(
      await screen.findByRole('textbox', {
        name: 'accountSettings.account.changeEmail.emailLabel',
      }),
    ).toBeVisible()
    expect(consoleClient.account.changeEmail.validity.post).toHaveBeenLastCalledWith({
      body: {
        email: 'old@example.com',
        code: '654321',
        token: 'email-token',
      },
    })
  })
})
