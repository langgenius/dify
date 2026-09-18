import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { checkEmailExisted, resetEmail, sendVerifyCode, verifyEmail } from '@/service/common'
import EmailChangeModal from '../email-change-modal'

vi.mock('@/service/common', () => ({
  checkEmailExisted: vi.fn(),
  resetEmail: vi.fn(),
  sendVerifyCode: vi.fn(),
  verifyEmail: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('EmailChangeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendVerifyCode).mockResolvedValue({ result: 'success', data: 'email-token' })
    vi.mocked(verifyEmail).mockResolvedValue({
      result: 'success',
      email: 'old@example.com',
      is_valid: true,
      token: 'verified-token',
    })
    vi.mocked(checkEmailExisted).mockResolvedValue({ result: 'success' })
  })

  it('submits the labeled verification fields with Enter through both email phases', async () => {
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" onClose={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'common.account.changeEmail.sendVerifyCode' }),
    )
    const originCode = await screen.findByRole('textbox', {
      name: 'common.account.changeEmail.codeLabel',
    })
    await user.type(originCode, '123456{Enter}')
    expect(verifyEmail).toHaveBeenCalledWith({
      email: 'old@example.com',
      code: '123456',
      token: 'email-token',
    })

    const email = await screen.findByRole('textbox', {
      name: 'common.account.changeEmail.emailLabel',
    })
    await user.type(email, 'new@example.com')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'common.account.changeEmail.sendVerifyCode' }),
      ).toBeEnabled(),
    )
    await user.type(email, '{Enter}')
    expect(sendVerifyCode).toHaveBeenLastCalledWith({
      email: 'new@example.com',
      phase: 'new_email',
      token: 'verified-token',
    })

    const newCode = await screen.findByRole('textbox', {
      name: 'common.account.changeEmail.codeLabel',
    })
    expect(newCode).toHaveValue('')
    await user.type(newCode, '654321{Enter}')
    await waitFor(() =>
      expect(resetEmail).toHaveBeenCalledWith({
        new_email: 'new@example.com',
        token: 'verified-token',
      }),
    )
  })

  it('associates an unavailable-email error and clears it when the user edits the address', async () => {
    vi.mocked(checkEmailExisted).mockRejectedValue({
      status: 400,
      json: async () => ({ code: 'email_already_in_use' }),
    })
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" onClose={vi.fn()} />)

    await user.click(
      screen.getByRole('button', { name: 'common.account.changeEmail.sendVerifyCode' }),
    )
    await user.type(
      await screen.findByRole('textbox', { name: 'common.account.changeEmail.codeLabel' }),
      '123456{Enter}',
    )
    const email = await screen.findByRole('textbox', {
      name: 'common.account.changeEmail.emailLabel',
    })
    await user.type(email, 'used@example.com')

    await screen.findByText('common.account.changeEmail.existingEmail')
    expect(email).toBeInvalid()
    expect(email).toHaveAccessibleDescription('common.account.changeEmail.existingEmail')
    await user.clear(email)
    expect(email).not.toBeInvalid()
    expect(screen.queryByText('common.account.changeEmail.existingEmail')).not.toBeInTheDocument()
  })
})
