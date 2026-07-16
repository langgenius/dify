import type { ReactElement } from 'react'
import type { MockedFunction } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useMailRegister } from '@/service/use-common'
import { getBrowserTimezone } from '@/utils/timezone'
import ChangePasswordForm from '../page'

const {
  mockRememberCreateAppExternalAttribution,
  mockRememberRegistrationSuccess,
  mockSendGAEvent,
} = vi.hoisted(() => ({
  mockRememberCreateAppExternalAttribution: vi.fn(),
  mockRememberRegistrationSuccess: vi.fn(),
  mockSendGAEvent: vi.fn(),
}))

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
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

vi.mock('@/app/components/base/amplitude/registration-tracking', () => ({
  rememberRegistrationSuccess: (...args: unknown[]) => mockRememberRegistrationSuccess(...args),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  rememberCreateAppExternalAttribution: (...args: unknown[]) =>
    mockRememberCreateAppExternalAttribution(...args),
}))

const mockRegister = vi.fn()
const mockReplace = vi.fn()

const mockUseLocale = useLocale as unknown as MockedFunction<typeof useLocale>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>
const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseMailRegister = useMailRegister as unknown as MockedFunction<typeof useMailRegister>
const mockGetBrowserTimezone = getBrowserTimezone as unknown as MockedFunction<
  typeof getBrowserTimezone
>

const renderWithQueryClient = (ui: ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('Signup Set Password Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Cookies.remove('utm_info')
    mockUseLocale.mockReturnValue('zh-Hans')
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('token=register-token') as unknown as ReturnType<typeof useSearchParams>,
    )
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<
      typeof useRouter
    >)
    mockUseMailRegister.mockReturnValue({
      mutateAsync: mockRegister,
      isPending: false,
    } as unknown as ReturnType<typeof useMailRegister>)
    mockGetBrowserTimezone.mockReturnValue('Asia/Shanghai')
    mockRegister.mockResolvedValue({ result: 'fail', data: {} })
  })

  describe('Registration payload', () => {
    it('should submit locale and browser timezone when setting password', async () => {
      renderWithQueryClient(<ChangePasswordForm />)

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

  // On successful registration the Amplitude event is deferred (remembered) so it can
  // fire after the user ID is attached, while the GA event still fires immediately.
  describe('Registration success tracking', () => {
    const fillAndSubmit = () => {
      fireEvent.change(screen.getByLabelText('common.account.newPassword'), {
        target: { value: 'ValidPass123!' },
      })
      fireEvent.change(screen.getByLabelText('common.account.confirmPassword'), {
        target: { value: 'ValidPass123!' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))
    }

    it('should defer the amplitude event and fire GA immediately when registration succeeds', async () => {
      mockRegister.mockResolvedValue({ result: 'success', data: {} })

      renderWithQueryClient(<ChangePasswordForm />)
      fillAndSubmit()

      await waitFor(() => {
        expect(mockRememberRegistrationSuccess).toHaveBeenCalledWith({
          method: 'email',
          utmInfo: null,
        })
      })
      expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success', {
        method: 'email',
      })
      expect(mockReplace).toHaveBeenCalledWith('/')
    })

    it('should return to the requested console page when registration succeeds', async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams(
          'token=register-token&redirect_url=%2Fapps%3Ftag%3Dworkflow',
        ) as unknown as ReturnType<typeof useSearchParams>,
      )
      mockRegister.mockResolvedValue({ result: 'success', data: {} })

      renderWithQueryClient(<ChangePasswordForm />)
      fillAndSubmit()

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/apps?tag=workflow')
      })
    })

    it('should remember the utm event with slug and clear the utm cookie when a utm_info cookie is present', async () => {
      Cookies.set('utm_info', JSON.stringify({ utm_source: 'community', slug: 'partner-launch' }))
      mockRegister.mockResolvedValue({ result: 'success', data: {} })

      renderWithQueryClient(<ChangePasswordForm />)
      fillAndSubmit()

      await waitFor(() => {
        expect(mockRememberRegistrationSuccess).toHaveBeenCalledWith({
          method: 'email',
          utmInfo: { utm_source: 'community', slug: 'partner-launch' },
        })
      })
      expect(mockRememberCreateAppExternalAttribution).toHaveBeenCalledWith({
        utmInfo: { utm_source: 'community', slug: 'partner-launch' },
      })
      expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
        method: 'email',
        utm_source: 'community',
        slug: 'partner-launch',
      })
      expect(Cookies.get('utm_info')).toBeUndefined()
    })
  })
})
