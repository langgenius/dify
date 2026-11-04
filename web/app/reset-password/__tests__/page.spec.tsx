import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '#i18n'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/storage'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient } from '@/service/console'
import ResetPasswordPage from '../page'

const mockPush = vi.fn()

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    forgotPassword: {
      post: vi.fn(),
    },
  },
}))

afterEach(() => localStorage.removeItem(COUNT_DOWN_KEY))

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem(COUNT_DOWN_KEY)
    vi.mocked(useLocale).mockReturnValue('en-US')
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as unknown as ReturnType<
      typeof useRouter
    >)
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as ReturnType<typeof useSearchParams>,
    )
    vi.mocked(consoleClient.forgotPassword.post).mockResolvedValue({
      result: 'success',
      data: 'reset-token',
    })
  })

  it('labels the email field and submits it with Enter', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordPage />)

    const emailInput = screen.getByRole('textbox', { name: 'login.email' })
    expect(emailInput).toHaveAttribute('autocomplete', 'email')

    await user.type(emailInput, 'user@example.com{Enter}')

    await waitFor(() => {
      expect(consoleClient.forgotPassword.post).toHaveBeenCalledWith({
        body: { email: 'user@example.com', language: 'en-US' },
      })
    })
    expect(localStorage.getItem(COUNT_DOWN_KEY)).toBe(String(COUNT_DOWN_TIME_MS))
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
    expect(consoleClient.forgotPassword.post).not.toHaveBeenCalled()

    await user.clear(emailInput)
    await user.click(screen.getByRole('button', { name: 'login.sendVerificationCode' }))

    const emptyErrors = await screen.findAllByText('login.error.emailEmpty')
    expect(emptyErrors).toHaveLength(1)
    expect(screen.queryByText('login.error.emailInValid')).not.toBeInTheDocument()
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveAccessibleDescription('login.error.emailEmpty')
    expect(emailInput).toHaveFocus()
    expect(consoleClient.forgotPassword.post).not.toHaveBeenCalled()
  })
})
