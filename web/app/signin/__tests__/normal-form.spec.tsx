import type { ReactElement } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useRouter, useSearchParams } from '@/next/navigation'
import { createHttpError } from '@/service/http-error'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import NormalForm from '../normal-form'

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

const mockReplace = vi.fn()
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

type QueryFixture = {
  data?: { profile?: { id: string; email: string } } | typeof invitationQueryResult.data
}
let profileResult: QueryFixture = {}
let inviteResult: QueryFixture = {}
const mockQueryResults = (profile: QueryFixture, invite: QueryFixture) => {
  profileResult = profile
  inviteResult = invite
}
const render = (ui: ReactElement, options: Parameters<typeof renderWithConsoleQuery>[1] = {}) => {
  const queryClient = createConsoleQueryClient()
  if (profileResult.data && 'profile' in profileResult.data) {
    seedAccountProfileQuery(queryClient, profileResult.data.profile)
  } else {
    const profileOptions = userProfileQueryOptions()
    queryClient.setQueryDefaults(profileOptions.queryKey, { retryOnMount: false })
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey: profileOptions.queryKey })
      .setState({
        status: 'error',
        fetchStatus: 'idle',
        error: createHttpError(new Response(null, { status: 401 }), { message: 'Not signed in' }),
      })
  }
  if (inviteResult.data)
    queryClient.setQueryData(['signin', 'invite-check', 'invite-token'], inviteResult.data)
  return renderWithConsoleQuery(ui, { ...options, queryClient, accountProfile: null })
}

describe('NormalForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ replace: mockReplace })
    mockUseSearchParams.mockReturnValue(new URLSearchParams())
  })

  it('exposes the page title as the main heading', () => {
    mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)

    render(<NormalForm />)

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  describe('Default Redirects', () => {
    it('should send logged-in visitors without a redirect target to the console home', async () => {
      const searchParams = new URLSearchParams()
      mockUseSearchParams.mockReturnValue(searchParams)
      mockQueryResults(loggedInQueryResult, nonInviteQueryResult)

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/')
      })
    })

    it('should send logged-in visitors with an external redirect target to the console home', async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams('redirect_url=https%3A%2F%2Fgoogle.com'),
      )
      mockQueryResults(loggedInQueryResult, nonInviteQueryResult)

      render(<NormalForm />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/')
      })
    })
  })

  describe('Invite Redirects', () => {
    it('should send logged-in invite visitors to the invite confirmation page', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('invite_token=invite-token'))
      mockQueryResults(loggedInQueryResult, invitationQueryResult)

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
        },
        invitationQueryResult,
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
        },
        invitationQueryResult,
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
      mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)
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

  it('should describe password visibility through its changing action name', async () => {
    const user = userEvent.setup()
    mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)

    render(<NormalForm />)

    const showPasswordButton = screen.getByRole('button', { name: 'login.showPassword' })
    expect(screen.getByLabelText('login.password')).toHaveAttribute('type', 'password')

    await user.click(showPasswordButton)

    expect(screen.getByRole('button', { name: 'login.hidePassword' })).toBeInTheDocument()
    expect(screen.getByLabelText('login.password')).toHaveAttribute('type', 'text')
  })

  it('keeps credential inputs together before secondary password actions in the tab order', async () => {
    const user = userEvent.setup()
    mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)

    render(<NormalForm />, {
      systemFeatures: { is_email_setup: true },
    })

    const emailInput = screen.getByLabelText('login.email')
    await user.click(emailInput)

    await user.tab()
    expect(screen.getByLabelText('login.password')).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'login.showPassword' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('link', { name: 'login.forget' })).toHaveFocus()
  })

  it('associates input validation errors with the invalid credential field', async () => {
    const user = userEvent.setup()
    mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)

    render(<NormalForm />)

    const emailInput = screen.getByLabelText('login.email')
    await user.type(emailInput, 'invalid-email')
    await user.type(screen.getByLabelText('login.password'), 'password')
    await user.click(screen.getByRole('button', { name: 'login.signBtn' }))

    const error = await screen.findByText('login.error.emailInValid')
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveAccessibleDescription(error.textContent ?? '')
    expect(emailInput).toHaveFocus()
  })

  it('should not expose SSO when it is enforced without a configured protocol', () => {
    mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)

    render(<NormalForm />, {
      systemFeatures: {
        sso_enforced_for_signin: true,
        sso_enforced_for_signin_protocol: null,
      },
    })

    expect(screen.queryByRole('button', { name: 'login.withSSO' })).not.toBeInTheDocument()
  })
})
