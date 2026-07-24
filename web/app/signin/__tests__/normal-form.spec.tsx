import { useQuery } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRouter, useSearchParams } from '@/next/navigation'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import NormalForm from '../normal-form'

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
  }
})

vi.mock('@/features/account-profile/client', () => ({
  isLegacyBase401: vi.fn(() => false),
  userProfileQueryOptions: vi.fn(() => ({
    queryKey: ['account', 'profile'],
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
const mockUseRouter = useRouter as unknown as ReturnType<typeof vi.fn>
const mockUseSearchParams = useSearchParams as unknown as ReturnType<typeof vi.fn>

const loggedInQueryResult = {
  isPending: false,
  data: {
    profile: {
      id: 'account-id',
      email: 'invitee@example.com',
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

const mockQueryResults = (
  profileResult: ReturnType<typeof useQuery>,
  inviteResult: ReturnType<typeof useQuery>,
) => {
  mockUseQuery.mockImplementation((options) => {
    const queryKey = options.queryKey as readonly unknown[]
    return (queryKey[0] === 'account' ? profileResult : inviteResult) as ReturnType<typeof useQuery>
  })
}

describe('NormalForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ replace: mockReplace })
    mockUseSearchParams.mockReturnValue(new URLSearchParams())
  })

  describe('Default Redirects', () => {
    it('should send logged-in visitors without a redirect target to the console home', async () => {
      const searchParams = new URLSearchParams()
      mockUseSearchParams.mockReturnValue(searchParams)
      mockQueryResults(
        loggedInQueryResult as unknown as ReturnType<typeof useQuery>,
        nonInviteQueryResult as unknown as ReturnType<typeof useQuery>,
      )

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/')
      })
    })

    it('should send logged-in visitors with an external redirect target to the console home', async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('redirect_url=https%3A%2F%2Fgoogle.com'),
      )
      mockQueryResults(
        loggedInQueryResult as unknown as ReturnType<typeof useQuery>,
        nonInviteQueryResult as unknown as ReturnType<typeof useQuery>,
      )

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/')
      })
    })
  })

  describe('Invite Redirects', () => {
    it('should send logged-in invite visitors to the invite confirmation page', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('invite_token=invite-token'))
      mockQueryResults(
        loggedInQueryResult as unknown as ReturnType<typeof useQuery>,
        invitationQueryResult as unknown as ReturnType<typeof useQuery>,
      )

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/signin/invite-settings?invite_token=invite-token',
        )
      })
    })

    it('should keep a different logged-in account on the invitation sign-in form', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('invite_token=invite-token'))
      mockQueryResults(
        {
          ...loggedInQueryResult,
          data: {
            profile: {
              id: 'account-id',
              email: 'current@example.com',
            },
          },
        } as unknown as ReturnType<typeof useQuery>,
        invitationQueryResult as unknown as ReturnType<typeof useQuery>,
      )

      render(<NormalForm />)

      expect(screen.getByRole('button', { name: 'login.signBtn' })).toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('should match the logged-in account email case-insensitively', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('invite_token=invite-token'))
      mockQueryResults(
        {
          ...loggedInQueryResult,
          data: {
            profile: {
              id: 'account-id',
              email: 'Invitee@Example.com',
            },
          },
        } as unknown as ReturnType<typeof useQuery>,
        invitationQueryResult as unknown as ReturnType<typeof useQuery>,
      )

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/signin/invite-settings?invite_token=invite-token',
        )
      })
    })
  })

  describe('Registration Navigation', () => {
    it('should preserve the current query when navigating to sign up', () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('redirect_url=%2Fapps%3Ftag%3Dworkflow&source=pricing'),
      )
      mockQueryResults(
        nonInviteQueryResult as unknown as ReturnType<typeof useQuery>,
        nonInviteQueryResult as unknown as ReturnType<typeof useQuery>,
      )
      render(<NormalForm />, {
        systemFeatures: {
          is_allow_register: true,
          branding: { enabled: true },
        },
      })

      expect(screen.getByRole('link', { name: 'login.signup.signUp' })).toHaveAttribute(
        'href',
        '/signup?redirect_url=%2Fapps%3Ftag%3Dworkflow&source=pricing',
      )
    })
  })
})
