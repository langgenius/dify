import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { checkEmailExisted, resetEmail, sendVerifyCode, verifyEmail } from '@/service/common'
import { EmailChangeModal } from '../email-change-modal'

const mockLogout = vi.fn()

vi.mock('@/service/common', () => ({
  checkEmailExisted: vi.fn(),
  resetEmail: vi.fn(),
  sendVerifyCode: vi.fn(),
  verifyEmail: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: mockLogout }),
}))

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

  it('submits both email phases with Enter and completes an accepted verification after dismissal', async () => {
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.change' }))

    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )
    const originCode = await screen.findByRole('textbox', {
      name: 'accountSettings.account.changeEmail.codeLabel',
    })
    await user.type(originCode, '123456{Enter}')
    expect(verifyEmail).toHaveBeenCalledWith({
      email: 'old@example.com',
      code: '123456',
      token: 'email-token',
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
    expect(sendVerifyCode).toHaveBeenLastCalledWith({
      email: 'new@example.com',
      phase: 'new_email',
      token: 'verified-token',
    })

    const newCode = await screen.findByRole('textbox', {
      name: 'accountSettings.account.changeEmail.codeLabel',
    })
    let finishVerify!: (value: Awaited<ReturnType<typeof verifyEmail>>) => void
    let finishReset!: (value: Awaited<ReturnType<typeof resetEmail>>) => void
    vi.mocked(verifyEmail).mockReturnValueOnce(
      new Promise((resolve) => {
        finishVerify = resolve
      }),
    )
    vi.mocked(resetEmail).mockReturnValueOnce(
      new Promise((resolve) => {
        finishReset = resolve
      }),
    )
    expect(newCode).toHaveValue('')
    await user.type(newCode, '654321{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(resetEmail).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await act(async () => {
      finishVerify({
        result: 'success',
        email: 'new@example.com',
        is_valid: true,
        token: 'verified-token',
      })
    })
    await waitFor(() =>
      expect(resetEmail).toHaveBeenCalledWith({
        new_email: 'new@example.com',
        token: 'verified-token',
      }),
    )
    expect(mockLogout).not.toHaveBeenCalled()
    await act(async () => {
      finishReset({ result: 'success' })
    })
    expect(mockLogout).toHaveBeenCalledOnce()
  })

  it('associates an unavailable-email error and clears it when the user edits the address', async () => {
    vi.mocked(checkEmailExisted).mockRejectedValue({
      status: 400,
      json: async () => ({ code: 'email_already_in_use' }),
    })
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.change' }))

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
  it('does not start an old countdown or advance a reopened session when a late send resolves', async () => {
    let finishSend!: (value: Awaited<ReturnType<typeof sendVerifyCode>>) => void
    vi.mocked(sendVerifyCode).mockReturnValueOnce(
      new Promise((resolve) => {
        finishSend = resolve
      }),
    )
    const user = userEvent.setup()
    const interval = vi.spyOn(globalThis, 'setInterval')
    render(<EmailChangeModal email="old@example.com" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.change' }))
    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'common.operation.change' }))
    interval.mockClear()
    await act(async () => {
      finishSend({ result: 'success', data: 'late-token' })
    })
    const lateTimers = interval.mock.results.map((result) => result.value)
    interval.mockRestore()
    lateTimers.forEach((timer) => clearInterval(timer))
    expect(lateTimers).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )
    expect(
      await screen.findByRole('textbox', { name: 'accountSettings.account.changeEmail.codeLabel' }),
    ).toHaveValue('')
  })

  it('keeps the existing transition to verification when sending the code fails', async () => {
    vi.mocked(sendVerifyCode).mockRejectedValueOnce(new Error('Email service unavailable'))
    const user = userEvent.setup()
    render(<EmailChangeModal email="old@example.com" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.change' }))
    await user.click(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.sendVerifyCode' }),
    )
    expect(
      await screen.findByRole('textbox', { name: 'accountSettings.account.changeEmail.codeLabel' }),
    ).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'accountSettings.account.changeEmail.resend' }),
    ).toBeEnabled()
  })
})
