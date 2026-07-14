import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('@/utils/var', () => ({ basePath: '' }))

type UseVerifyResult = ReturnType<typeof useVerifyForgotPasswordToken>
const mockUseVerify = vi.mocked(useVerifyForgotPasswordToken)
const mockChangePassword = vi.mocked(changePasswordWithToken)

const VALID_PASSWORD = 'ValidPass123!'

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      expect(screen.getByText('login.changePassword')).toBeInTheDocument()
    })

    it('submits with T2 (from validity response), NOT T1 (from URL)', async () => {
      mockChangePassword.mockResolvedValue({ result: 'success' })

      render(<ChangePasswordForm />)

      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
      ) as [HTMLInputElement, HTMLInputElement]
      fireEvent.change(inputs[0], { target: { value: VALID_PASSWORD } })
      fireEvent.change(inputs[1], { target: { value: VALID_PASSWORD } })

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.reset/ }))

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
      expect(screen.getByText('login.invalid')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /common\.operation\.reset/ }),
      ).not.toBeInTheDocument()
    })
  })
})
