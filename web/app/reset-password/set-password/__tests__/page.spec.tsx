import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const mockReplace = vi.fn()
const mockUseRouter = vi.mocked(useRouter)
const mockUseSearchParams = vi.mocked(useSearchParams)
const mockChangePasswordWithToken = vi.mocked(changePasswordWithToken)

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
