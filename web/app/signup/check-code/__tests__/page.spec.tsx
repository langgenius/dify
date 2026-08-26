import type { MockedFunction } from 'vite-plus/test'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useMailValidity, useSendMail } from '@/service/use-common'
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

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useMailValidity: vi.fn(),
  useSendMail: vi.fn(),
}))

const mockUseLocale = useLocale as unknown as MockedFunction<typeof useLocale>
const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>
const mockUseMailValidity = useMailValidity as unknown as MockedFunction<typeof useMailValidity>
const mockUseSendMail = useSendMail as unknown as MockedFunction<typeof useSendMail>

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
    } as unknown as ReturnType<typeof useMailValidity>)
    mockUseSendMail.mockReturnValue({
      mutateAsync: mockSubmitMail,
    } as unknown as ReturnType<typeof useSendMail>)
    mockVerifyCode.mockResolvedValue({ is_valid: true, token: 'verified-token' })
  })

  it('labels the one-time code field and submits it with Enter', async () => {
    const user = userEvent.setup()
    render(<CheckCode />)

    const codeInput = screen.getByRole('textbox', {
      name: 'login.checkCode.verificationCode',
    })
    expect(codeInput).toHaveAttribute('id', 'code')
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
        code: '123456',
        email: 'user@example.com',
        token: 'signup-token',
      })
    })
    expect(mockVerifyCode).toHaveBeenCalledTimes(1)
  })
})
