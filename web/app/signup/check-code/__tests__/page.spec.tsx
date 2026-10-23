import type { MockedFunction } from 'vite-plus/test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '#i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import CheckCode from '../page'

const mockBack = vi.fn()
const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockSubmitMail = vi.fn()
const mockVerifyCode = vi.fn()

vi.mock('@/app/components/signin/countdown', () => ({
  default: ({ onResend }: { onResend: () => void }) => (
    <button type="button" onClick={onResend}>
      resend-code
    </button>
  ),
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

const mockUseLocale = useLocale as MockedFunction<typeof useLocale>
const mockUseRouter = useRouter as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as MockedFunction<typeof useSearchParams>

describe('Signup Check Code Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLocale.mockReturnValue('en-US')
    mockUseRouter.mockReturnValue({
      back: mockBack,
      push: mockPush,
      replace: mockReplace,
    } as unknown as ReturnType<typeof useRouter>)
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams({
        email: 'user@example.com',
        token: 'signup-token',
      }) as ReturnType<typeof useSearchParams>,
    )
    mockVerifyCode.mockResolvedValue({ is_valid: true, token: 'verified-token' })
  })

  it('labels the one-time code field and submits it with Enter', async () => {
    const user = userEvent.setup()
    render(<CheckCode />)

    const codeInput = screen.getByRole('textbox', {
      name: 'login.checkCode.verificationCode',
    })
    expect(codeInput).toHaveAttribute('name', 'code')
    expect(codeInput).toHaveAttribute('inputmode', 'numeric')
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code')
    expect(screen.getByRole('button', { name: 'login.checkCode.verify' })).toHaveAttribute(
      'type',
      'submit',
    )

    await user.type(codeInput, '123456{Enter}')

    await waitFor(() => {
      expect(mockVerifyCode).toHaveBeenCalledWith({
        body: {
          code: '123456',
          email: 'user@example.com',
          token: 'signup-token',
        },
      })
    })
    expect(mockVerifyCode).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
    const destination = new URL(mockPush.mock.calls[0]![0], window.location.origin)
    expect(destination.pathname).toBe('/signup/set-password')
    expect(destination.searchParams.get('email')).toBe('user@example.com')
    expect(destination.searchParams.get('token')).toBe('verified-token')
  })

  it('associates one localized error with an incomplete verification code', async () => {
    const user = userEvent.setup()
    render(<CheckCode />)

    const codeInput = screen.getByRole('textbox', {
      name: 'login.checkCode.verificationCode',
    })
    await user.type(codeInput, '12345{Enter}')

    const errors = await screen.findAllByText('login.checkCode.invalidCode')
    expect(errors).toHaveLength(1)
    expect(codeInput).toHaveAttribute('aria-invalid', 'true')
    expect(codeInput).toHaveAccessibleDescription('login.checkCode.invalidCode')
    expect(codeInput).toHaveFocus()
    expect(mockVerifyCode).not.toHaveBeenCalled()
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'emailRegister.sendEmail.post': (input) => mockSubmitMail(input),
      'emailRegister.validity.post': (input) => mockVerifyCode(input),
    }),
  }
})
