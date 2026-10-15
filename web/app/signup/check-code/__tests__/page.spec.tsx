import type { MockedFunction } from 'vite-plus/test'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '#i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import CheckCode from '../page'

const { mockSendMailHook, mockMailValidityHook } = vi.hoisted(() => ({
  mockSendMailHook: vi.fn(),
  mockMailValidityHook: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'emailRegister.sendEmail.post': (options: unknown) => mockSendMailHook(options),
    'emailRegister.validity.post': (options: unknown) => mockMailValidityHook(options),
  })
})

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

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

const mockUseLocale = useLocale as unknown as MockedFunction<typeof useLocale>
const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>
const mockUseMailValidity = mockMailValidityHook
const mockUseSendMail = mockSendMailHook

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
      }) as unknown as ReturnType<typeof useSearchParams>,
    )
    mockUseMailValidity.mockReturnValue({
      mutateAsync: mockVerifyCode,
    } as unknown as ReturnType<typeof mockMailValidityHook>)
    mockUseSendMail.mockReturnValue({
      mutateAsync: mockSubmitMail,
    } as unknown as ReturnType<typeof mockSendMailHook>)
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
