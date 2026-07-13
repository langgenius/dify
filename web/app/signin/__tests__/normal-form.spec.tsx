import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRouter, useSearchParams } from '@/next/navigation'
import NormalForm from '../normal-form'

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
    useSuspenseQuery: vi.fn(),
  }
})

vi.mock('@/features/account-profile/client', () => ({
  isLegacyBase401: vi.fn(() => false),
  userProfileQueryOptions: vi.fn(() => ({
    queryKey: ['account', 'profile'],
    queryFn: vi.fn(),
  })),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: vi.fn(() => ({
    queryKey: ['system-features'],
    queryFn: vi.fn(),
  })),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/common', async () => {
  const actual = await vi.importActual<typeof import('@/service/common')>('@/service/common')
  return {
    ...actual,
    invitationCheck: vi.fn(),
  }
})

const mockReplace = vi.fn()
const mockUseQuery = vi.mocked(useQuery)
const mockUseSuspenseQuery = vi.mocked(useSuspenseQuery)
const mockUseRouter = useRouter as unknown as ReturnType<typeof vi.fn>
const mockUseSearchParams = useSearchParams as unknown as ReturnType<typeof vi.fn>

const loggedInQueryResult = {
  isPending: false,
  data: {
    profile: {
      id: 'account-id',
    },
  },
  error: null,
}

const invitationQueryResult = {
  isPending: false,
  isError: false,
  data: {
    is_valid: true,
    data: {
      workspace_name: 'Acme',
      workspace_id: 'workspace-id',
      email: 'invitee@example.com',
    },
  },
}

const nonInviteQueryResult = {
  isPending: false,
  isError: false,
  data: undefined,
}

describe('NormalForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ replace: mockReplace })
    mockUseSearchParams.mockReturnValue(new URLSearchParams())
    mockUseSuspenseQuery.mockReturnValue({
      data: {
        enable_social_oauth_login: false,
        sso_enforced_for_signin: false,
        enable_email_code_login: false,
        enable_email_password_login: true,
        is_email_setup: true,
        is_allow_register: false,
        license: {
          status: 'none',
        },
        branding: {
          enabled: true,
        },
      },
    } as unknown as ReturnType<typeof useSuspenseQuery>)
  })

  describe('Default Redirects', () => {
    it('should send logged-in visitors without a redirect target to the console home', async () => {
      const searchParams = new URLSearchParams()
      mockUseSearchParams.mockReturnValue(searchParams)
      mockUseQuery
        .mockReturnValueOnce(loggedInQueryResult as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce(nonInviteQueryResult as unknown as ReturnType<typeof useQuery>)

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/')
      })
    })
  })

  describe('Invite Redirects', () => {
    it('should send logged-in invite visitors to the invite confirmation page', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('invite_token=invite-token'))
      mockUseQuery
        .mockReturnValueOnce(loggedInQueryResult as unknown as ReturnType<typeof useQuery>)
        .mockReturnValueOnce(invitationQueryResult as unknown as ReturnType<typeof useQuery>)

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/signin/invite-settings?invite_token=invite-token',
        )
      })
    })
  })
})
