import type { ReactElement } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
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

const deployment = vi.hoisted(() => ({ basePath: '' }))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return deployment.basePath
  },
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
    deployment.basePath = ''
    mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)
    mockUseRouter.mockReturnValue({ replace: mockReplace })
    mockUseSearchParams.mockReturnValue(new URLSearchParams())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('End User Account login', () => {
    const target = {
      is_end_user: '1',
      app_code: 'my-webapp',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
      redirect_url:
        'https://agent-app.dify.dev/web-prefix/chat/my-webapp?conversation=existing&input=hello%20world#turn-2',
    }

    beforeEach(() => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams(target))
      mockQueryResults(nonInviteQueryResult, nonInviteQueryResult)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init)
          if (request.method !== 'GET' || !new URL(request.url).pathname.endsWith('/login'))
            throw new Error(`Unexpected request: ${request.method} ${request.url}`)
          return Response.json({ logged_in: false, redirect_url: null })
        }),
      )
    })

    it('probes Account login when its deployment prefix differs from the Web App without requiring workspace admission', async () => {
      const requests: Request[] = []
      deployment.basePath = '/account-prefix'
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({ logged_in: false, redirect_url: null })
      })
      render(<NormalForm />)

      expect(await screen.findByRole('button', { name: 'login.signBtn' })).toBeInTheDocument()
      expect(requests).toHaveLength(1)
      expect(requests[0]!.method).toBe('GET')
      const request = new URL(requests[0]!.url)
      expect(request.pathname).toMatch(/\/login$/)
      expect(Object.fromEntries(request.searchParams)).toEqual({
        mode: 'end_user',
        app_code: target.app_code,
        code_challenge: target.code_challenge,
        redirect_url: target.redirect_url,
      })
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('shows the page error without a duplicate Toast when the Account handoff service is unavailable', async () => {
      const errorToast = vi.spyOn(toast, 'error').mockReturnValue('unexpected-toast')
      const requests: Request[] = []
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json(
          {
            code: 'web_login_unavailable',
            status: 503,
            message: 'Account sign-in is temporarily unavailable.',
          },
          { status: 503 },
        )
      })
      render(<NormalForm />)

      expect(await screen.findByText('share.common.appUnknownError')).toBeVisible()
      expect(screen.queryByRole('button', { name: 'login.signBtn' })).not.toBeInTheDocument()
      expect(requests).toHaveLength(1)
      expect(requests[0]!.method).toBe('GET')
      expect(new URL(requests[0]!.url).pathname).toMatch(/\/login$/)
      expect(mockReplace).not.toHaveBeenCalled()
      expect(errorToast).not.toHaveBeenCalled()
    })

    it('sends only End User mode and the credentials in the actual password request', async () => {
      const user = userEvent.setup()
      const requests: Request[] = []
      let submitted: unknown
      mockUseSearchParams.mockReturnValue(new URLSearchParams({ ...target, mode: 'console' }))
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        if (request.method === 'GET') return Response.json({ logged_in: false, redirect_url: null })
        submitted = await request.json()
        return Response.json({ result: 'fail', data: 'Login not completed' })
      })
      render(<NormalForm />)

      await screen.findByRole('button', { name: 'login.signBtn' })
      await user.type(screen.getByLabelText('login.email'), 'account@example.com')
      await user.type(screen.getByLabelText('login.password'), 'Password123!')
      await user.click(screen.getByRole('button', { name: 'login.signBtn' }))

      await waitFor(() =>
        expect(submitted).toEqual({
          mode: 'end_user',
          email: 'account@example.com',
          password: expect.any(String),
          remember_me: true,
        }),
      )
      expect(requests.map((request) => request.method)).toEqual(['GET', 'POST'])
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('returns through Account sign-in after password login and converts the backend callback into the App URL', async () => {
      const user = userEvent.setup()
      const replace = vi.fn()
      const requests: Request[] = []
      const callback = `https://agent-app.dify.dev/web-prefix/webapp-signin?${new URLSearchParams({
        mode: 'end_user',
        redirect_url: target.redirect_url,
        login_code: 'one-use-code',
      })}`
      let authenticated = false
      vi.stubGlobal('location', {
        href: window.location.href,
        origin: window.location.origin,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        replace,
      })
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        if (request.method === 'POST') {
          authenticated = true
          return Response.json({ result: 'success' })
        }
        return Response.json({
          logged_in: authenticated,
          redirect_url: authenticated ? callback : null,
        })
      })
      const firstVisit = render(<NormalForm />)

      await screen.findByRole('button', { name: 'login.signBtn' })
      await user.type(screen.getByLabelText('login.email'), 'account@example.com')
      await user.type(screen.getByLabelText('login.password'), 'Password123!')
      await user.click(screen.getByRole('button', { name: 'login.signBtn' }))

      await waitFor(() => expect(replace).toHaveBeenCalledOnce())
      const resume = new URL(replace.mock.calls[0]![0])
      expect(resume.origin).toBe(window.location.origin)
      expect(resume.pathname).toBe('/signin')
      expect(Object.fromEntries(resume.searchParams)).toEqual(target)
      firstVisit.unmount()
      mockUseSearchParams.mockReturnValue(resume.searchParams)
      render(<NormalForm />)

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(2))
      const destination = new URL(replace.mock.calls[1]![0])
      expect(destination.origin).toBe('https://agent-app.dify.dev')
      expect(destination.pathname).toBe('/web-prefix/chat/my-webapp')
      expect(destination.hash).toBe('#turn-2')
      expect(Object.fromEntries(destination.searchParams)).toEqual({
        conversation: 'existing',
        input: 'hello world',
        mode: 'end_user',
        redirect_url: target.redirect_url,
        login_code: 'one-use-code',
      })
      expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET'])
      expect(new URL(requests[2]!.url).searchParams.get('code_challenge')).toBe(
        target.code_challenge,
      )
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it.each(['/console', '/chat'])(
      'reuses an Account session under %s and navigates directly to the App with its query and hash',
      async (accountBasePath) => {
        deployment.basePath = accountBasePath
        const replace = vi.fn()
        const callback = `https://agent-app.dify.dev/web-prefix/webapp-signin?${new URLSearchParams(
          {
            mode: 'end_user',
            redirect_url: target.redirect_url,
            login_code: 'existing-account-code',
          },
        )}`
        vi.stubGlobal('location', {
          href: window.location.href,
          origin: window.location.origin,
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
          replace,
        })
        vi.mocked(globalThis.fetch).mockImplementation(async () =>
          Response.json({ logged_in: true, redirect_url: callback }),
        )
        render(<NormalForm />)

        await waitFor(() => expect(replace).toHaveBeenCalledOnce())
        const destination = new URL(replace.mock.calls[0]![0])
        expect(destination.origin).toBe('https://agent-app.dify.dev')
        expect(destination.pathname).toBe('/web-prefix/chat/my-webapp')
        expect(destination.hash).toBe('#turn-2')
        expect(Object.fromEntries(destination.searchParams)).toEqual({
          conversation: 'existing',
          input: 'hello world',
          mode: 'end_user',
          redirect_url: target.redirect_url,
          login_code: 'existing-account-code',
        })
        expect(screen.queryByRole('button', { name: 'login.signBtn' })).not.toBeInTheDocument()
        expect(globalThis.fetch).toHaveBeenCalledOnce()
      },
    )

    it.each(['return URL', 'origin'] as const)(
      'rejects an Account callback with a mismatched %s',
      async (mismatch) => {
        const replace = vi.fn()
        const callback = new URL('https://agent-app.dify.dev/web-prefix/webapp-signin')
        callback.search = new URLSearchParams({
          mode: 'end_user',
          redirect_url:
            mismatch === 'return URL'
              ? 'https://agent-app.dify.dev/web-prefix/chat/another-app'
              : target.redirect_url,
          login_code: 'unexpected-code',
        }).toString()
        if (mismatch === 'origin') callback.hostname = 'untrusted.example'
        vi.stubGlobal('location', { ...window.location, replace })
        vi.mocked(globalThis.fetch).mockImplementation(async () =>
          Response.json({ logged_in: true, redirect_url: callback.href }),
        )
        render(<NormalForm />)

        expect(await screen.findByText('share.common.appUnknownError')).toBeVisible()
        expect(replace).not.toHaveBeenCalled()
        expect(mockReplace).not.toHaveBeenCalled()
      },
    )

    it('only offers supported End User login methods without probing the workspace', async () => {
      render(<NormalForm />, {
        systemFeatures: {
          sso_enforced_for_signin: true,
          sso_enforced_for_signin_protocol: 'oidc',
          is_allow_register: true,
        },
      })

      expect(await screen.findByRole('button', { name: 'login.signBtn' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'login.withSSO' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'login.signup.signUp' })).not.toBeInTheDocument()
      expect(globalThis.fetch).toHaveBeenCalledOnce()
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('shows the unavailable-method state when only unsupported enterprise SSO is configured', async () => {
      render(<NormalForm />, {
        systemFeatures: {
          sso_enforced_for_signin: true,
          sso_enforced_for_signin_protocol: 'saml',
          enable_email_code_login: false,
          enable_email_password_login: false,
          enable_social_oauth_login: false,
        },
      })

      expect(await screen.findByText('login.noLoginMethod')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'login.withSSO' })).not.toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
    })

    it.each(['redirect_url', 'code_challenge'])(
      'does not fall back to Console sign-in when the End User %s is missing',
      (missing) => {
        const params = new URLSearchParams(target)
        params.delete(missing)
        mockUseSearchParams.mockReturnValue(params)
        render(<NormalForm />)

        expect(screen.queryByRole('button', { name: 'login.signBtn' })).not.toBeInTheDocument()
        expect(globalThis.fetch).not.toHaveBeenCalled()
        expect(mockReplace).not.toHaveBeenCalled()
      },
    )
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
