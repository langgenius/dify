import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendResetPasswordCode } from '@/service/common'
import ResetPasswordPage from '../page'

const mockPush = vi.fn()
const mockSetCountdownLeftTime = vi.fn()

vi.mock('@/app/components/signin/storage', () => ({
  COUNT_DOWN_TIME_MS: 60_000,
  useSetCountdownLeftTime: () => mockSetCountdownLeftTime,
}))

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  sendResetPasswordCode: vi.fn(),
}))

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLocale).mockReturnValue('en-US')
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as unknown as ReturnType<
      typeof useRouter
    >)
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    )
    vi.mocked(sendResetPasswordCode).mockResolvedValue({ result: 'success', data: 'reset-token' })
  })

  it('labels the email field and submits it with Enter', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    const emailInput = screen.getByRole('textbox', { name: 'login.email' })
    expect(emailInput).toHaveAttribute('autocomplete', 'email')

    await user.type(emailInput, 'user@example.com{Enter}')

    await waitFor(() => {
      expect(sendResetPasswordCode).toHaveBeenCalledWith('user@example.com', 'en-US')
    })
    expect(mockPush).toHaveBeenCalledWith(
      '/reset-password/check-code?token=reset-token&email=user%2540example.com',
    )
  })

  it('keeps one associated error when an invalid email is cleared', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    const emailInput = screen.getByRole('textbox', { name: 'login.email' })
    await user.type(emailInput, 'invalid-email{Enter}')

    const invalidErrors = await screen.findAllByText('login.error.emailInValid')
    expect(invalidErrors).toHaveLength(1)
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveAccessibleDescription('login.error.emailInValid')
    expect(emailInput).toHaveFocus()
    expect(sendResetPasswordCode).not.toHaveBeenCalled()

    await user.clear(emailInput)
    await user.click(screen.getByRole('button', { name: 'login.sendVerificationCode' }))

    const emptyErrors = await screen.findAllByText('login.error.emailEmpty')
    expect(emptyErrors).toHaveLength(1)
    expect(screen.queryByText('login.error.emailInValid')).not.toBeInTheDocument()
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveAccessibleDescription('login.error.emailEmpty')
    expect(emailInput).toHaveFocus()
    expect(sendResetPasswordCode).not.toHaveBeenCalled()
  })
})
