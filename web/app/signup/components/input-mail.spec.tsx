import type { MockedFunction } from 'vite-plus/test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useLocale } from '#i18n'
import { useSearchParams } from '@/next/navigation'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import SignupEmailForm from './input-mail'

const mockSubmitMail = vi.fn()
const mockOnSuccess = vi.fn()

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    className,
    target,
    rel,
  }: {
    children: React.ReactNode
    href: string
    className?: string
    target?: string
    rel?: string
  }) => (
    <a href={href} className={className} target={target} rel={rel}>
      {children}
    </a>
  ),
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

const mockUseLocale = useLocale as MockedFunction<typeof useLocale>
const mockUseSearchParams = useSearchParams as MockedFunction<typeof useSearchParams>

const renderForm = ({
  brandingEnabled = false,
}: {
  brandingEnabled?: boolean
} = {}) => {
  mockUseLocale.mockReturnValue('en-US')
  return renderWithConsoleQuery(<SignupEmailForm onSuccess={mockOnSuccess} />, {
    systemFeatures: { branding: { enabled: brandingEnabled } },
  })
}

describe('InputMail Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchParams.mockReturnValue(new URLSearchParams() as ReturnType<typeof useSearchParams>)
    mockSubmitMail.mockResolvedValue({ result: 'success', data: 'token' })
  })

  // Rendering baseline UI elements.
  describe('Rendering', () => {
    it('should render email input and submit button', () => {
      renderForm()

      const emailInput = screen.getByRole('textbox', { name: 'login.email' })
      const submitButton = screen.getByRole('button', { name: 'login.signup.verifyMail' })

      expect(emailInput).toHaveAttribute('name', 'email')
      expect(emailInput).toHaveAttribute('type', 'email')
      expect(emailInput).toHaveAttribute('autocomplete', 'email')
      expect(emailInput).toHaveAttribute('spellcheck', 'false')
      expect(emailInput).toHaveProperty('tabIndex', 0)
      expect(submitButton).toHaveAttribute('type', 'submit')
      expect(submitButton).toHaveProperty('tabIndex', 0)
      expect(screen.getByRole('link', { name: 'login.signup.signIn' })).toBeInTheDocument()
    })
  })

  // Prop-driven branding content visibility.
  describe('Props', () => {
    it('should show terms links when branding is disabled', () => {
      renderForm({ brandingEnabled: false })

      expect(screen.getByRole('link', { name: 'login.tos' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'login.pp' })).toBeInTheDocument()
    })

    it('should hide terms links when branding is enabled', () => {
      renderForm({ brandingEnabled: true })

      expect(screen.queryByRole('link', { name: 'login.tos' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'login.pp' })).not.toBeInTheDocument()
    })
  })

  // Submission flow and mutation integration.
  describe('User Interactions', () => {
    it('should submit email and call onSuccess when mutation succeeds', async () => {
      const user = userEvent.setup()
      renderForm()
      const input = screen.getByRole('textbox', { name: 'login.email' })

      await user.type(input, 'test@example.com{Enter}')

      expect(mockSubmitMail).toHaveBeenCalledWith({
        body: {
          email: 'test@example.com',
          language: 'en-US',
        },
      })
      expect(mockSubmitMail).toHaveBeenCalledTimes(1)

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalledWith('test@example.com', 'token')
      })
    })
  })

  // Navigation between registration and login keeps the original destination.
  describe('Registration Navigation', () => {
    it('should preserve the current query when navigating to sign in', () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('redirect_url=%2Fapps%3Ftag%3Dworkflow&source=pricing') as ReturnType<
          typeof useSearchParams
        >,
      )

      renderForm()

      expect(screen.getByRole('link', { name: 'login.signup.signIn' })).toHaveAttribute(
        'href',
        '/signin?redirect_url=%2Fapps%3Ftag%3Dworkflow&source=pricing',
      )
    })
  })

  // Validation and failure paths.
  describe('Edge Cases', () => {
    it('should block submission when email is invalid', async () => {
      const user = userEvent.setup()
      renderForm()
      const input = screen.getByLabelText('login.email')

      await user.type(input, 'invalid-email{Enter}')

      const error = await screen.findByText('login.error.emailInValid')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription(error.textContent ?? '')
      expect(input).toHaveFocus()
      expect(mockSubmitMail).not.toHaveBeenCalled()
      expect(mockOnSuccess).not.toHaveBeenCalled()
    })

    it('should not call onSuccess when mutation does not succeed', async () => {
      const user = userEvent.setup()
      mockSubmitMail.mockResolvedValue({ result: 'failed', data: 'token' })
      renderForm()
      const input = screen.getByLabelText('login.email')
      const button = screen.getByRole('button', { name: 'login.signup.verifyMail' })

      await user.type(input, 'test@example.com')
      await user.click(button)

      await waitFor(() => {
        expect(mockSubmitMail).toHaveBeenCalled()
      })
      expect(mockOnSuccess).not.toHaveBeenCalled()
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'emailRegister.sendEmail.post': (input) => mockSubmitMail(input),
    }),
  }
})
