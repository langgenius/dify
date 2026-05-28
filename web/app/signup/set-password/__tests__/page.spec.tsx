import type { MockedFunction } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useMailRegister } from '@/service/use-common'
import { getBrowserTimezone } from '@/utils/timezone'
import ChangePasswordForm from '../page'

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useMailRegister: vi.fn(),
}))

vi.mock('@/utils/timezone', () => ({
  getBrowserTimezone: vi.fn(),
}))

vi.mock('@/utils/gtag', () => ({
  sendGAEvent: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  rememberCreateAppExternalAttribution: vi.fn(),
}))

const mockRegister = vi.fn()
const mockReplace = vi.fn()

const mockUseLocale = useLocale as unknown as MockedFunction<typeof useLocale>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>
const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseMailRegister = useMailRegister as unknown as MockedFunction<typeof useMailRegister>
const mockGetBrowserTimezone = getBrowserTimezone as unknown as MockedFunction<typeof getBrowserTimezone>

describe('Signup Set Password Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLocale.mockReturnValue('zh-Hans')
    mockUseSearchParams.mockReturnValue(new URLSearchParams('token=register-token') as unknown as ReturnType<typeof useSearchParams>)
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
    mockUseMailRegister.mockReturnValue({
      mutateAsync: mockRegister,
      isPending: false,
    } as unknown as ReturnType<typeof useMailRegister>)
    mockGetBrowserTimezone.mockReturnValue('Asia/Shanghai')
    mockRegister.mockResolvedValue({ result: 'fail', data: {} })
  })

  describe('Registration payload', () => {
    it('should submit locale and browser timezone when setting password', async () => {
      render(<ChangePasswordForm />)

      fireEvent.change(screen.getByLabelText('common.account.newPassword'), {
        target: { value: 'ValidPass123!' },
      })
      fireEvent.change(screen.getByLabelText('common.account.confirmPassword'), {
        target: { value: 'ValidPass123!' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith({
          token: 'register-token',
          new_password: 'ValidPass123!',
          password_confirm: 'ValidPass123!',
          language: 'zh-Hans',
          timezone: 'Asia/Shanghai',
        })
      })
    })
  })
})
