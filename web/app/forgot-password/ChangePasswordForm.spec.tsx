import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useDocumentTitle from '@/hooks/use-document-title'
import { changePasswordWithToken } from '@/service/common'
import { useVerifyForgotPasswordToken } from '@/service/use-common'
import ChangePasswordForm from './ChangePasswordForm'

const mockReplace = vi.fn()
vi.mock('@/next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=url-token-t1'),
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/service/use-common', () => ({
  useVerifyForgotPasswordToken: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  changePasswordWithToken: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/utils/var', () => ({ basePath: '' }))

type UseVerifyResult = ReturnType<typeof useVerifyForgotPasswordToken>
const mockUseVerify = vi.mocked(useVerifyForgotPasswordToken)
const mockChangePassword = vi.mocked(changePasswordWithToken)
const mockUseDocumentTitle = vi.mocked(useDocumentTitle)

const VALID_PASSWORD = 'ValidPass123!'

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the loading title while the token is being verified', () => {
    mockUseVerify.mockReturnValue({
      data: undefined,
      refetch: vi.fn(),
    } as unknown as UseVerifyResult)

    render(<ChangePasswordForm />)

    expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('common.loading')
  })

  describe('when token is valid', () => {
    const T2 = 'verified-token-t2'

    beforeEach(() => {
      mockUseVerify.mockReturnValue({
        data: { result: 'success', is_valid: true, email: 'user@example.com', token: T2 },
        refetch: vi.fn(),
      } as unknown as UseVerifyResult)
    })

    it('renders the password form', () => {
      render(<ChangePasswordForm />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.changePassword')
      expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('login.changePassword')
    })

    it('submits with T2 (from validity response), NOT T1 (from URL)', async () => {
      const user = userEvent.setup()
      mockChangePassword.mockResolvedValue({ result: 'success' })

      render(<ChangePasswordForm />)

      const passwordInput = screen.getByLabelText('common.account.newPassword')
      const confirmPasswordInput = screen.getByLabelText('common.account.confirmPassword')
      await user.type(passwordInput, VALID_PASSWORD)
      await user.type(confirmPasswordInput, VALID_PASSWORD)
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(mockChangePassword).toHaveBeenCalledWith({
          url: '/forgot-password/resets',
          body: {
            token: T2,
            new_password: VALID_PASSWORD,
            password_confirm: VALID_PASSWORD,
          },
        })
      })
    })

    it('uses the success title after the password is changed', async () => {
      const user = userEvent.setup()
      mockChangePassword.mockResolvedValue({ result: 'success' })

      render(<ChangePasswordForm />)

      await user.type(screen.getByLabelText('common.account.newPassword'), VALID_PASSWORD)
      await user.type(screen.getByLabelText('common.account.confirmPassword'), VALID_PASSWORD)
      await user.click(screen.getByRole('button', { name: /common\.operation\.reset/ }))

      expect(
        await screen.findByRole('heading', { level: 1, name: 'login.passwordChangedTip' }),
      ).toBeInTheDocument()
      expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('login.passwordChangedTip')
    })

    it('keeps one associated error when an invalid password is cleared', async () => {
      const user = userEvent.setup()
      render(<ChangePasswordForm />)

      const passwordInput = screen.getByLabelText('common.account.newPassword')
      expect(passwordInput).toHaveAccessibleDescription('login.error.passwordInvalid')

      await user.type(passwordInput, 'weak')
      await user.click(screen.getByRole('button', { name: /common\.operation\.reset/ }))

      const invalidErrors = await screen.findAllByText('login.error.passwordInvalid')
      expect(invalidErrors).toHaveLength(1)
      expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
      expect(passwordInput).toHaveAccessibleDescription('login.error.passwordInvalid')
      expect(passwordInput).toHaveFocus()
      expect(mockChangePassword).not.toHaveBeenCalled()

      await user.clear(passwordInput)
      await user.click(screen.getByRole('button', { name: /common\.operation\.reset/ }))

      const emptyErrors = await screen.findAllByText('login.error.passwordEmpty')
      expect(emptyErrors).toHaveLength(1)
      expect(screen.queryByText('login.error.passwordInvalid')).not.toBeInTheDocument()
      expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
      expect(passwordInput).toHaveAccessibleDescription('login.error.passwordEmpty')
      expect(passwordInput).toHaveFocus()
      expect(mockChangePassword).not.toHaveBeenCalled()
    })

    it('associates a password mismatch with the confirmation field', async () => {
      const user = userEvent.setup()
      render(<ChangePasswordForm />)

      await user.type(screen.getByLabelText('common.account.newPassword'), VALID_PASSWORD)
      const confirmPasswordInput = screen.getByLabelText('common.account.confirmPassword')
      await user.type(confirmPasswordInput, 'DifferentPass123!{Enter}')

      const error = await screen.findByText('common.account.notEqual')
      expect(confirmPasswordInput).toHaveAttribute('aria-invalid', 'true')
      expect(confirmPasswordInput).toHaveAccessibleDescription(error.textContent ?? '')
      expect(confirmPasswordInput).toHaveFocus()
      expect(mockChangePassword).not.toHaveBeenCalled()
    })

    it('prevents duplicate submissions while the password is changing', async () => {
      const user = userEvent.setup()
      let resolveRequest:
        | ((value: Awaited<ReturnType<typeof changePasswordWithToken>>) => void)
        | undefined
      mockChangePassword.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
      )

      render(<ChangePasswordForm />)

      await user.type(screen.getByLabelText('common.account.newPassword'), VALID_PASSWORD)
      await user.type(screen.getByLabelText('common.account.confirmPassword'), VALID_PASSWORD)

      const submitButton = screen.getByRole('button', { name: /common\.operation\.reset/ })
      await user.click(submitButton)

      await waitFor(() => {
        expect(submitButton).toHaveAttribute('aria-disabled', 'true')
      })
      await user.click(submitButton)
      expect(mockChangePassword).toHaveBeenCalledTimes(1)

      resolveRequest?.({ result: 'success' })
      await screen.findByRole('heading', { level: 1, name: 'login.passwordChangedTip' })
    })
  })

  describe('when token is invalid', () => {
    beforeEach(() => {
      mockUseVerify.mockReturnValue({
        data: { result: 'success', is_valid: false, email: '', token: '' },
        refetch: vi.fn(),
      } as unknown as UseVerifyResult)
    })

    it('shows invalid token state and no form', () => {
      render(<ChangePasswordForm />)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.invalid')
      expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('login.invalid')
      expect(
        screen.queryByRole('button', { name: /common\.operation\.reset/ }),
      ).not.toBeInTheDocument()
    })
  })
})
