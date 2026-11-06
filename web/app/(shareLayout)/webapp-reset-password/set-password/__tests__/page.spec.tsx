import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter, useSearchParams } from '@/next/navigation'
import { changeWebAppPasswordWithToken } from '@/service/common'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ChangePasswordForm from '../page'

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  changeWebAppPasswordWithToken: vi.fn(),
}))

describe('Webapp Reset Password Set Password Page', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useRouter).mockReturnValue({ replace: vi.fn() } as unknown as ReturnType<
      typeof useRouter
    >)
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({ token: 'reset-token' }) as ReturnType<typeof useSearchParams>,
    )
    vi.mocked(changeWebAppPasswordWithToken).mockResolvedValue({ result: 'success' })
  })

  it('reconciles the route title initially and updates it after a successful reset', async () => {
    const user = userEvent.setup()
    render(<ChangePasswordForm />)

    expect(document.title).toContain('login.changePassword')

    await user.type(screen.getByLabelText('accountSettings.account.newPassword'), 'ValidPass123!')
    await user.type(
      screen.getByLabelText('accountSettings.account.confirmPassword'),
      'ValidPass123!',
    )
    await user.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))
    expect(changeWebAppPasswordWithToken).toHaveBeenCalledWith({
      url: '/forgot-password/resets',
      body: {
        token: 'reset-token',
        new_password: 'ValidPass123!',
        password_confirm: 'ValidPass123!',
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'login.passwordChangedTip',
      )
    })
    expect(document.title).toContain('login.passwordChangedTip')
  })
})
