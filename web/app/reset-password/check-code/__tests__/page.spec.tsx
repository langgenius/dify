import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { verifyResetPasswordCode } from '@/service/common'
import CheckCodePage from '../page'

const mockPush = vi.fn()

vi.mock('@/app/components/signin/countdown', () => ({
  default: () => null,
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
  verifyResetPasswordCode: vi.fn(),
}))

describe('ResetPasswordCheckCodePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLocale).mockReturnValue('en-US')
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as unknown as ReturnType<
      typeof useRouter
    >)
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({
        email: 'user@example.com',
        token: 'email-token',
      }) as unknown as ReturnType<typeof useSearchParams>,
    )
    vi.mocked(verifyResetPasswordCode).mockResolvedValue({
      result: 'success',
      is_valid: true,
      token: 'verified-token',
    })
  })

  it('labels the one-time code field and submits it with Enter', async () => {
    const user = userEvent.setup()
    render(<CheckCodePage />)

    const codeInput = screen.getByRole('textbox', {
      name: 'login.checkCode.verificationCode',
    })
    expect(codeInput).toHaveAttribute('inputmode', 'numeric')
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code')

    await user.type(codeInput, '123456{Enter}')

    await waitFor(() => {
      expect(verifyResetPasswordCode).toHaveBeenCalledWith({
        code: '123456',
        email: 'user@example.com',
        token: 'email-token',
      })
    })
    expect(mockPush).toHaveBeenCalledWith(
      '/reset-password/set-password?email=user%40example.com&token=verified-token',
    )
  })

  it('associates an incomplete code error with the field', async () => {
    const user = userEvent.setup()
    render(<CheckCodePage />)

    const codeInput = screen.getByRole('textbox', {
      name: 'login.checkCode.verificationCode',
    })
    await user.type(codeInput, '123{Enter}')

    const error = await screen.findByText('login.checkCode.invalidCode')
    expect(codeInput).toHaveAttribute('aria-invalid', 'true')
    expect(codeInput).toHaveAccessibleDescription(error.textContent ?? '')
    expect(codeInput).toHaveFocus()
    expect(verifyResetPasswordCode).not.toHaveBeenCalled()
  })
})
