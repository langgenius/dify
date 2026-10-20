import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient } from '@/service/console'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ChangePasswordForm from '../page'

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, replace, ...props }: React.ComponentProps<'a'> & { replace?: boolean }) => (
    <a {...props} data-replace={replace || undefined}>
      {children}
    </a>
  ),
}))

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    forgotPassword: {
      resets: {
        post: vi.fn(),
      },
    },
  },
}))

const mockReplace = vi.fn()
const mockUseRouter = vi.mocked(useRouter)
const mockUseSearchParams = vi.mocked(useSearchParams)
const mockChangePasswordWithToken = vi.mocked(consoleClient.forgotPassword.resets.post)

const redirectUrl = '/apps?template-id=template-1&utm_source=dify_blog'
const encodedSigninUrl =
  '/signin?redirect_url=%2Fapps%3Ftemplate-id%3Dtemplate-1%26utm_source%3Ddify_blog'

const setSearchParams = (params: Record<string, string>) => {
  mockUseSearchParams.mockReturnValue(
    new URLSearchParams(params) as ReturnType<typeof useSearchParams>,
  )
}

const completePasswordChange = async () => {
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {})
  render(<ChangePasswordForm />)

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.changePassword')

  await user.type(screen.getByLabelText('accountSettings.account.newPassword'), 'ValidPass123!')
  await user.type(screen.getByLabelText('accountSettings.account.confirmPassword'), 'ValidPass123!')
  await user.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

  await waitFor(() => {
    expect(screen.getByRole('link', { name: /login\.passwordChanged/ })).toBeInTheDocument()
  })
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.passwordChangedTip')
  expect(document.title).toBe('login.passwordChangedTip - Dify')
}

describe('Reset Password Set Password Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<
      typeof useRouter
    >)
    mockChangePasswordWithToken.mockResolvedValue({ result: 'success' })
    setSearchParams({ token: 'reset-token' })
  })

  it('reconciles the initial route title with client branding', () => {
    render(<ChangePasswordForm />, {
      systemFeatures: { branding: { enabled: true, application_title: 'Acme' } },
    })

    expect(document.title).toBe('login.changePassword - Acme')
  })

  it('supports password reveal and native form submission', async () => {
    const user = userEvent.setup()
    render(<ChangePasswordForm />)

    const passwordInput = screen.getByLabelText('accountSettings.account.newPassword')
    const confirmPasswordInput = screen.getByLabelText('accountSettings.account.confirmPassword')

    expect(passwordInput).toHaveAttribute('autocomplete', 'new-password')
    expect(passwordInput).toHaveAccessibleDescription('login.error.passwordInvalid')
    expect(confirmPasswordInput).toHaveAttribute('autocomplete', 'new-password')

    await user.type(passwordInput, 'ValidPass123!')
    await user.click(screen.getAllByRole('button', { name: 'login.showPassword' })[0]!)

    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'login.hidePassword' })).toBeInTheDocument()

    await user.type(confirmPasswordInput, 'ValidPass123!{Enter}')

    await waitFor(() => {
      expect(mockChangePasswordWithToken).toHaveBeenCalledWith({
        body: {
          token: 'reset-token',
          new_password: 'ValidPass123!',
          password_confirm: 'ValidPass123!',
        },
      })
    })
  })

  it('revalidates the confirmation field when the password changes', async () => {
    const user = userEvent.setup()
    render(<ChangePasswordForm />)

    const passwordInput = screen.getByLabelText('accountSettings.account.newPassword')
    await user.type(passwordInput, 'ValidPass123!')
    const confirmPasswordInput = screen.getByLabelText('accountSettings.account.confirmPassword')
    await user.type(confirmPasswordInput, 'DifferentPass123!{Enter}')

    const error = await screen.findByText('accountSettings.account.notEqual')
    expect(confirmPasswordInput).toHaveAttribute('aria-invalid', 'true')
    expect(confirmPasswordInput).toHaveAccessibleDescription(error.textContent ?? '')
    expect(confirmPasswordInput).toHaveFocus()
    expect(mockChangePasswordWithToken).not.toHaveBeenCalled()

    await user.clear(passwordInput)
    await user.type(passwordInput, 'DifferentPass123!')

    await waitFor(() => {
      expect(screen.queryByText('accountSettings.account.notEqual')).not.toBeInTheDocument()
    })
    expect(confirmPasswordInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(mockChangePasswordWithToken).not.toHaveBeenCalled()
  })

  describe('Post-reset navigation', () => {
    it('should preserve redirect_url when the user returns to sign in manually', async () => {
      setSearchParams({ token: 'reset-token', redirect_url: redirectUrl })
      await completePasswordChange()

      const link = screen.getByRole('link', { name: /login\.passwordChanged/ })
      expect(link).toHaveAttribute('href', encodedSigninUrl)
      expect(link).toHaveAttribute('data-replace', 'true')
    })

    it('should preserve redirect_url when the countdown returns to sign in automatically', async () => {
      setSearchParams({ token: 'reset-token', redirect_url: redirectUrl })
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await completePasswordChange()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000)
        })
      } finally {
        vi.useRealTimers()
      }

      expect(mockReplace).toHaveBeenCalledWith(encodedSigninUrl)
    })

    it('should preserve the activation redirect when an invite token is present', async () => {
      setSearchParams({
        token: 'reset-token',
        invite_token: 'invite-token',
        redirect_url: redirectUrl,
      })
      await completePasswordChange()

      expect(screen.getByRole('link', { name: /login\.passwordChanged/ })).toHaveAttribute(
        'href',
        '/activate?token=invite-token',
      )
    })

    it('should return to plain sign in when no redirect target is present', async () => {
      await completePasswordChange()

      expect(screen.getByRole('link', { name: /login\.passwordChanged/ })).toHaveAttribute(
        'href',
        '/signin',
      )
    })
  })
})
