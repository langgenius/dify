import type { MockedFunction } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { activateMember } from '@/service/common'
import { useInvitationCheck } from '@/service/use-common'
import { getBrowserTimezone } from '@/utils/timezone'
import InviteSettingsPage from '../page'

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useSuspenseQuery: vi.fn(() => ({
      data: {
        branding: {
          enabled: true,
        },
      },
    })),
  }
})

vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(),
}))

vi.mock('@/i18n-config', () => ({
  i18n: {
    defaultLocale: 'en-US',
  },
  setLocaleOnClient: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  activateMember: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useInvitationCheck: vi.fn(),
}))

vi.mock('@/utils/timezone', () => ({
  getBrowserTimezone: vi.fn(),
  timezones: [
    { value: 'Asia/Shanghai', name: 'Asia/Shanghai' },
    { value: 'America/Los_Angeles', name: 'America/Los_Angeles' },
  ],
}))

vi.mock('../utils/post-login-redirect', () => ({
  resolvePostLoginRedirect: vi.fn(() => null),
}))

const mockReplace = vi.fn()
const mockRefetch = vi.fn()

const mockUseLocale = useLocale as unknown as MockedFunction<typeof useLocale>
const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>
const mockActivateMember = activateMember as unknown as MockedFunction<typeof activateMember>
const mockUseInvitationCheck = useInvitationCheck as unknown as MockedFunction<typeof useInvitationCheck>
const mockGetBrowserTimezone = getBrowserTimezone as unknown as MockedFunction<typeof getBrowserTimezone>

describe('InviteSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLocale.mockReturnValue('zh-Hans')
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('invite_token=invite-token') as unknown as ReturnType<typeof useSearchParams>,
    )
    mockUseInvitationCheck.mockReturnValue({
      data: {
        is_valid: true,
        data: {
          workspace_name: 'Acme',
          workspace_id: 'workspace-id',
          email: 'invitee@example.com',
        },
      },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useInvitationCheck>)
    mockGetBrowserTimezone.mockReturnValue('Asia/Shanghai')
    mockActivateMember.mockResolvedValue({ result: 'success' })
  })

  describe('Activation payload', () => {
    it('should default language to the current UI locale', async () => {
      render(<InviteSettingsPage />)

      fireEvent.change(screen.getByLabelText('login.name'), {
        target: { value: 'Invitee' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'login.join Acme' }))

      await waitFor(() => {
        expect(mockActivateMember).toHaveBeenCalledWith({
          url: '/activate',
          body: {
            token: 'invite-token',
            name: 'Invitee',
            interface_language: 'zh-Hans',
            timezone: 'Asia/Shanghai',
          },
        })
      })
    })

    it('should fall back to configured default locale when current locale is unsupported', async () => {
      mockUseLocale.mockReturnValue('unsupported-locale' as ReturnType<typeof useLocale>)

      render(<InviteSettingsPage />)

      fireEvent.change(screen.getByLabelText('login.name'), {
        target: { value: 'Invitee' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'login.join Acme' }))

      await waitFor(() => {
        expect(mockActivateMember).toHaveBeenCalledWith({
          url: '/activate',
          body: {
            token: 'invite-token',
            name: 'Invitee',
            interface_language: 'en-US',
            timezone: 'Asia/Shanghai',
          },
        })
      })
    })
  })
})
