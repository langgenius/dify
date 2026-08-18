import type { MockedFunction } from 'vite-plus/test'
import { useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { activateMember } from '@/service/common'
import { useInvitationCheck } from '@/service/use-common'
import { getBrowserTimezone } from '@/utils/timezone'
import InviteSettingsPage from '../page'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...actual,
    ...createReactI18nextMock({
      'login.joinWorkspace': 'Rejoindre {{workspaceName}}',
    }),
  }
})

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
    useQueryClient: vi.fn(() => ({
      resetQueries: vi.fn(),
    })),
    useSuspenseQuery: vi.fn(() => ({
      data: {
        branding: {
          application_title: 'Acme AI',
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

const mockReplace = vi.fn()
const mockRefetch = vi.fn()

const mockUseLocale = useLocale as unknown as MockedFunction<typeof useLocale>
const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>
const mockActivateMember = activateMember as unknown as MockedFunction<typeof activateMember>
const mockUseQuery = vi.mocked(useQuery)
const mockUseInvitationCheck = useInvitationCheck as unknown as MockedFunction<
  typeof useInvitationCheck
>
const mockGetBrowserTimezone = getBrowserTimezone as unknown as MockedFunction<
  typeof getBrowserTimezone
>

describe('InviteSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.title = ''
    mockUseLocale.mockReturnValue('zh-Hans')
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<
      typeof useRouter
    >)
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('invite_token=invite-token') as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    mockUseInvitationCheck.mockReturnValue({
      data: {
        is_valid: true,
        data: {
          workspace_name: 'Acme',
          workspace_id: 'workspace-id',
          email: 'invitee@example.com',
          requires_setup: true,
        },
      },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useInvitationCheck>)
    mockUseQuery.mockReturnValue({
      data: {
        profile: {
          id: 'account-id',
          email: 'invitee@example.com',
        },
      },
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useQuery>)
    mockGetBrowserTimezone.mockReturnValue('Asia/Shanghai')
    mockActivateMember.mockResolvedValue({ result: 'success' })
  })

  it('exposes the page title as the main heading', () => {
    render(<InviteSettingsPage />)

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(document.title).toBe('login.setYourAccount - Acme AI')
  })

  it('uses the workspace invitation as the page title for an active account', () => {
    mockUseInvitationCheck.mockReturnValue({
      data: {
        is_valid: true,
        data: {
          workspace_name: 'Acme',
          workspace_id: 'workspace-id',
          email: 'invitee@example.com',
          account_status: 'active',
          requires_setup: false,
        },
      },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useInvitationCheck>)

    render(<InviteSettingsPage />)

    expect(document.title).toBe('Rejoindre Acme - Acme AI')
  })

  describe('Activation payload', () => {
    it('should default language to the current UI locale', async () => {
      render(<InviteSettingsPage />)

      fireEvent.change(screen.getByLabelText('login.name'), {
        target: { value: 'Invitee' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))

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
      fireEvent.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))

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

    it('should only submit the token when an active account accepts an invitation', async () => {
      mockUseInvitationCheck.mockReturnValue({
        data: {
          is_valid: true,
          data: {
            workspace_name: 'Acme',
            workspace_id: 'workspace-id',
            email: 'invitee@example.com',
            account_status: 'active',
            requires_setup: false,
          },
        },
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useInvitationCheck>)

      render(<InviteSettingsPage />)

      expect(screen.queryByLabelText('login.name')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))

      await waitFor(() => {
        expect(mockActivateMember).toHaveBeenCalledWith({
          url: '/activate',
          body: {
            token: 'invite-token',
          },
        })
      })
    })

    it('should only submit the token when an active account check omits setup state', async () => {
      mockUseInvitationCheck.mockReturnValue({
        data: {
          is_valid: true,
          data: {
            workspace_name: 'Acme',
            workspace_id: 'workspace-id',
            email: 'invitee@example.com',
            account_status: 'active',
          },
        },
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useInvitationCheck>)

      render(<InviteSettingsPage />)

      expect(screen.queryByLabelText('login.name')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))

      await waitFor(() => {
        expect(mockActivateMember).toHaveBeenCalledWith({
          url: '/activate',
          body: {
            token: 'invite-token',
          },
        })
      })
    })

    it('should submit setup fields when the invitation requires account setup', async () => {
      mockUseInvitationCheck.mockReturnValue({
        data: {
          is_valid: true,
          data: {
            workspace_name: 'Acme',
            workspace_id: 'workspace-id',
            email: 'invitee@example.com',
            account_status: 'active',
            requires_setup: true,
          },
        },
        refetch: mockRefetch,
      } as unknown as ReturnType<typeof useInvitationCheck>)

      render(<InviteSettingsPage />)

      fireEvent.change(screen.getByLabelText('login.name'), {
        target: { value: 'Invitee' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))

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
  })

  describe('Post-activation redirect', () => {
    it('should use the console home when the redirect target is external', async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams(
          'invite_token=invite-token&redirect_url=https%3A%2F%2Fgoogle.com',
        ) as unknown as ReturnType<typeof useSearchParams>,
      )

      render(<InviteSettingsPage />)

      fireEvent.change(screen.getByLabelText('login.name'), {
        target: { value: 'Invitee' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Rejoindre Acme' }))

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/')
      })
    })
  })

  describe('Invitation account guard', () => {
    it('should redirect a different logged-in account back to the invitation sign-in form', async () => {
      mockUseQuery.mockReturnValue({
        data: {
          profile: {
            id: 'current-account-id',
            email: 'current@example.com',
          },
        },
        isPending: false,
        error: null,
      } as unknown as ReturnType<typeof useQuery>)

      render(<InviteSettingsPage />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/signin?invite_token=invite-token')
      })
      expect(screen.queryByRole('button', { name: 'Rejoindre Acme' })).not.toBeInTheDocument()
      expect(mockActivateMember).not.toHaveBeenCalled()
    })

    it('should allow case-insensitive email matches', () => {
      mockUseQuery.mockReturnValue({
        data: {
          profile: {
            id: 'account-id',
            email: 'Invitee@Example.com',
          },
        },
        isPending: false,
        error: null,
      } as unknown as ReturnType<typeof useQuery>)

      render(<InviteSettingsPage />)

      expect(screen.getByRole('button', { name: 'Rejoindre Acme' })).toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
    })
  })
})
