import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { changePasswordWithToken } from '@/service/common'
import ChangePasswordForm from '../page'

const countdownState = vi.hoisted(() => ({
  onEnd: undefined as (() => void) | undefined,
}))

vi.mock('ahooks', () => ({
  useCountDown: ({ leftTime, onEnd }: { leftTime?: number; onEnd?: () => void }) => {
    countdownState.onEnd = onEnd
    return [leftTime ?? 0]
  },
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  changePasswordWithToken: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const mockReplace = vi.fn()
const mockUseRouter = vi.mocked(useRouter)
const mockUseSearchParams = vi.mocked(useSearchParams)
const mockChangePasswordWithToken = vi.mocked(changePasswordWithToken)
const mockUseDocumentTitle = vi.mocked(useDocumentTitle)

const redirectUrl = '/apps?template-id=template-1&utm_source=dify_blog'
const encodedSigninUrl =
  '/signin?redirect_url=%2Fapps%3Ftemplate-id%3Dtemplate-1%26utm_source%3Ddify_blog'

const setSearchParams = (params: Record<string, string>) => {
  mockUseSearchParams.mockReturnValue(
    new URLSearchParams(params) as unknown as ReturnType<typeof useSearchParams>,
  )
}

const completePasswordChange = async () => {
  render(<ChangePasswordForm />)

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.changePassword')

  fireEvent.change(screen.getByLabelText('common.account.newPassword'), {
    target: { value: 'ValidPass123!' },
  })
  fireEvent.change(screen.getByLabelText('common.account.confirmPassword'), {
    target: { value: 'ValidPass123!' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /login\.passwordChanged/ })).toBeInTheDocument()
  })
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.passwordChangedTip')
  expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('login.passwordChangedTip')
}

describe('Reset Password Set Password Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countdownState.onEnd = undefined
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<
      typeof useRouter
    >)
    mockChangePasswordWithToken.mockResolvedValue({ result: 'success' })
    setSearchParams({ token: 'reset-token' })
  })

  it('reconciles the initial route title with client branding', () => {
    render(<ChangePasswordForm />)

    expect(mockUseDocumentTitle).toHaveBeenCalledWith('login.changePassword')
  })

  it('supports password reveal and native form submission', async () => {
    const user = userEvent.setup()
    render(<ChangePasswordForm />)

    const passwordInput = screen.getByLabelText('common.account.newPassword')
    const confirmPasswordInput = screen.getByLabelText('common.account.confirmPassword')

    expect(passwordInput).toHaveAttribute('autocomplete', 'new-password')
    expect(confirmPasswordInput).toHaveAttribute('autocomplete', 'new-password')

    await user.type(passwordInput, 'ValidPass123!')
    await user.click(screen.getAllByRole('button', { name: 'login.showPassword' })[0]!)

    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'login.hidePassword' })).toBeInTheDocument()

    await user.type(confirmPasswordInput, 'ValidPass123!{Enter}')

    await waitFor(() => {
      expect(mockChangePasswordWithToken).toHaveBeenCalledWith({
        url: '/forgot-password/resets',
        body: {
          token: 'reset-token',
          new_password: 'ValidPass123!',
          password_confirm: 'ValidPass123!',
        },
      })
    })
  })

  describe('Post-reset navigation', () => {
    it('should preserve redirect_url when the user returns to sign in manually', async () => {
      setSearchParams({ token: 'reset-token', redirect_url: redirectUrl })
      await completePasswordChange()

      fireEvent.click(screen.getByRole('button', { name: /login\.passwordChanged/ }))

      expect(mockReplace).toHaveBeenCalledWith(encodedSigninUrl)
    })

    it('should preserve redirect_url when the countdown returns to sign in automatically', async () => {
      setSearchParams({ token: 'reset-token', redirect_url: redirectUrl })
      await completePasswordChange()

      expect(countdownState.onEnd).toBeTypeOf('function')
      act(() => countdownState.onEnd?.())

      expect(mockReplace).toHaveBeenCalledWith(encodedSigninUrl)
    })

    it('should preserve the activation redirect when an invite token is present', async () => {
      setSearchParams({
        token: 'reset-token',
        invite_token: 'invite-token',
        redirect_url: redirectUrl,
      })
      await completePasswordChange()

      fireEvent.click(screen.getByRole('button', { name: /login\.passwordChanged/ }))

      expect(mockReplace).toHaveBeenCalledWith('/activate?token=invite-token')
    })

    it('should return to plain sign in when no redirect target is present', async () => {
      await completePasswordChange()

      fireEvent.click(screen.getByRole('button', { name: /login\.passwordChanged/ }))

      expect(mockReplace).toHaveBeenCalledWith('/signin')
    })
  })
})
