import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { DeepPartial } from '@/test/console/system-features'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import CheckCode from '../check-code/page'
import NormalForm from '../normal-form'

const navigation = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn(),
  replaceDocument: vi.fn(),
  search: '',
}))

const login = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

// boundary: keep the generated Console client and query policy, but never contact the API.
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[], input: unknown) => {
      if (path.join('.') === 'login.get') return login.get(input)
      if (path.join('.') === 'login.post') return login.post(input)
      if (path.join('.') === 'emailCodeLogin.post') return login.sendCode(input)
      if (path.join('.') === 'emailCodeLogin.validity.post') return login.verifyCode(input)
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    },
  },
}))

// boundary: a full navigation would leave the test runner; keep same-origin router handling real.
vi.mock('@/utils/login-redirect.client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/login-redirect.client')>()
  return {
    ...actual,
    replaceLoginRedirect: (...args: Parameters<typeof actual.replaceLoginRedirect>) => {
      if (args[0].kind === 'absolute') navigation.replaceDocument(args[0].href)
      else actual.replaceLoginRedirect(...args)
    },
  }
})

type ProfileState =
  | 'pending'
  | 'signed-out'
  | {
      id: string
      email: string
    }

type InvitationData = {
  is_valid: boolean
  data: {
    workspace_name: string
    workspace_id: string
    email: string
    is_current_account: boolean
  }
}

async function renderForm({
  profile = 'signed-out',
  invitation,
  systemFeatures,
}: {
  profile?: ProfileState
  invitation?: InvitationData
  systemFeatures?: DeepPartial<GetSystemFeaturesResponse>
} = {}) {
  const queryClient = createConsoleQueryClient()
  const profileOptions = userProfileQueryOptions()
  if (profile === 'pending') {
    void queryClient.query({
      queryKey: profileOptions.queryKey,
      queryFn: () => new Promise(() => {}),
    })
  } else if (profile === 'signed-out') {
    queryClient.setQueryDefaults(profileOptions.queryKey, { retryOnMount: false })
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey: profileOptions.queryKey })
      .setState({
        status: 'error',
        fetchStatus: 'idle',
        error: createHttpError(new Response(null, { status: 401 }), {
          message: 'Not signed in',
        }),
      })
  } else {
    seedAccountProfileQuery(queryClient, profile)
  }
  if (invitation)
    queryClient.setQueryData(
      consoleQuery.activate.check.get.queryKey({ input: { query: { token: 'invite-token' } } }),
      invitation,
    )

  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    queryClient,
    accountProfile: null,
    systemFeatures,
  })
  return render(
    <ConsoleProvider>
      <NormalForm />
    </ConsoleProvider>,
  )
}

const invitation: InvitationData = {
  is_valid: true,
  data: {
    workspace_name: 'Acme',
    workspace_id: 'workspace-id',
    email: 'invitee@example.com',
    is_current_account: false,
  },
}

const webappUrl = 'https://webapp.example.test/web'
const endUserReturnPath = '/connections?sort=recent&q=a%26b#details'
const endUserSearch = new URLSearchParams({
  is_end_user: '1',
  redirect_url: endUserReturnPath,
}).toString()

beforeEach(() => {
  navigation.push.mockReset()
  navigation.replace.mockReset()
  navigation.replaceDocument.mockReset()
  navigation.search = ''
  login.get.mockReset().mockResolvedValue({ logged_in: false, redirect_url: null })
  login.post.mockReset().mockResolvedValue({ result: 'success' })
  login.sendCode.mockReset().mockResolvedValue({ result: 'success', data: 'code-token' })
  login.verifyCode.mockReset().mockResolvedValue({ result: 'success' })
})

it('renders the native sign-in controls while the login probe is pending', async () => {
  const screen = await renderForm({ profile: 'pending' })
  const email = screen.getByLabelText('login.email')
  const password = screen.getByLabelText('login.password')

  await expect.element(screen.getByRole('heading', { level: 1 })).toBeVisible()
  await expect.element(email).toHaveAttribute('type', 'email')
  await expect.element(email).toHaveAttribute('autocomplete', 'email')
  await expect.element(password).toHaveAttribute('type', 'password')
  expect(navigation.replace).not.toHaveBeenCalled()

  const reveal = screen.getByRole('button', { name: 'login.showPassword' })
  await userEvent.click(reveal)
  await expect.element(reveal).toHaveAttribute('aria-pressed', 'true')
  await expect.element(password).toHaveAttribute('type', 'text')
})

it.each([
  { scenario: 'no requested destination', search: '' },
  {
    scenario: 'an external requested destination',
    search: 'redirect_url=https%3A%2F%2Fgoogle.com',
  },
])('redirects a logged-in visitor with $scenario to the console home', async ({ search }) => {
  navigation.search = search

  await renderForm({ profile: { id: 'account-id', email: 'invitee@example.com' } })

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
})

it('keeps a Console relative target on Console even when WebApp has a separate origin', async () => {
  navigation.search = 'redirect_url=%2Fapps%3Ftag%3Dworkflow%23recent&is_end_user=0'

  await renderForm({
    profile: { id: 'account-id', email: 'builder@example.com' },
    systemFeatures: { webapp_url: webappUrl },
  })

  await vi.waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith('/apps?tag=workflow#recent'),
  )
  expect(login.get).not.toHaveBeenCalled()
})

it('exchanges an existing End User session and follows the resolved WebApp destination', async () => {
  navigation.search = endUserSearch
  login.get.mockResolvedValue({ logged_in: true, redirect_url: `${webappUrl}${endUserReturnPath}` })

  await renderForm({ systemFeatures: { webapp_url: webappUrl } })

  await vi.waitFor(() =>
    expect(navigation.replaceDocument).toHaveBeenCalledWith(`${webappUrl}${endUserReturnPath}`),
  )
  expect(login.get).toHaveBeenCalledWith({
    query: { mode: 'end_user', redirect_url: endUserReturnPath },
  })
  expect(navigation.replace).not.toHaveBeenCalled()
})

it('resumes End User sign-in after password authentication without changing the relative target', async () => {
  navigation.search = endUserSearch
  const screen = await renderForm({ systemFeatures: { webapp_url: webappUrl } })

  await userEvent.fill(screen.getByLabelText('login.email'), 'end-user@example.com')
  await userEvent.fill(screen.getByLabelText('login.password'), 'Example123!')
  await userEvent.click(screen.getByRole('button', { name: 'login.signBtn' }))

  await vi.waitFor(() =>
    expect(navigation.replaceDocument).toHaveBeenCalledWith(
      `${window.location.origin}/signin?${endUserSearch}`,
    ),
  )
  expect(login.post).toHaveBeenCalledWith({
    body: expect.objectContaining({ email: 'end-user@example.com', mode: 'end_user' }),
  })
})

it('preserves a relative End User target through email verification without carrying credentials back', async () => {
  navigation.search = endUserSearch
  const signIn = await renderForm({
    systemFeatures: { enable_email_password_login: false, enable_email_code_login: true },
  })
  await userEvent.fill(signIn.getByLabelText('login.email'), 'end-user@example.com')
  await userEvent.click(signIn.getByRole('button', { name: 'login.signup.verifyMail' }))
  await expect.poll(() => navigation.push.mock.lastCall?.[0]).toMatch(/^\/signin\/check-code\?/)
  expect(login.sendCode).toHaveBeenCalledWith({
    body: expect.objectContaining({ email: 'end-user@example.com', mode: 'end_user' }),
  })

  const checkCodeUrl = navigation.push.mock.lastCall![0]
  navigation.search = new URL(checkCodeUrl, window.location.origin).search
  await signIn.unmount()
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  const verification = await render(
    <ConsoleProvider>
      <CheckCode />
    </ConsoleProvider>,
  )
  await userEvent.fill(verification.getByLabelText('login.checkCode.verificationCode'), '123456')
  await userEvent.click(verification.getByRole('button', { name: 'login.checkCode.verify' }))

  await vi.waitFor(() =>
    expect(navigation.replaceDocument).toHaveBeenCalledWith(
      `${window.location.origin}/signin?${endUserSearch}`,
    ),
  )
  expect(login.verifyCode).toHaveBeenCalledWith({
    body: expect.objectContaining({ mode: 'end_user', token: 'code-token' }),
  })
})

it('keeps OAuth resume on Console while carrying the relative End User return URL', async () => {
  navigation.search = endUserSearch
  const screen = await renderForm({ systemFeatures: { enable_social_oauth_login: true } })

  const github = screen.getByRole('link', { name: 'login.withGitHub' })
  await expect.element(github).toBeVisible()
  const { searchParams } = new URL((github.element() as HTMLAnchorElement).href)
  expect(searchParams.get('mode')).toBe('end_user')
  expect(searchParams.get('redirect_url')).toBe(`/signin?${endUserSearch}`)
})

it('redirects the matching signed-in account to invitation settings without requiring a workspace profile', async () => {
  navigation.search = 'invite_token=invite-token'

  await renderForm({
    profile: 'signed-out',
    invitation: {
      ...invitation,
      data: { ...invitation.data, is_current_account: true },
    },
  })

  await vi.waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith(
      '/signin/invite-settings?invite_token=invite-token',
    ),
  )
})

it('keeps a different or unauthenticated visitor on the invitation sign-in form', async () => {
  navigation.search = 'invite_token=invite-token'

  const screen = await renderForm({
    profile: { id: 'account-id', email: 'current@example.com' },
    invitation: {
      ...invitation,
      data: { ...invitation.data, is_current_account: false },
    },
  })

  await expect.element(screen.getByRole('button', { name: 'login.signBtn' })).toBeVisible()
  expect(navigation.replace).not.toHaveBeenCalled()
})

it('preserves the current query when navigating to sign up', async () => {
  navigation.search = 'redirect_url=%2Fapps%3Ftag%3Dworkflow&source=pricing'

  const screen = await renderForm({
    systemFeatures: {
      is_allow_register: true,
      branding: { enabled: true },
    },
  })

  await expect
    .element(screen.getByRole('link', { name: 'login.signup.signUp' }))
    .toHaveAttribute('href', '/signup?redirect_url=%2Fapps%3Ftag%3Dworkflow&source=pricing')
})

it('keeps credential inputs before secondary actions in native tab order', async () => {
  const screen = await renderForm({ systemFeatures: { is_email_setup: true } })
  const email = screen.getByLabelText('login.email')

  await userEvent.click(email)
  await userEvent.tab()
  await expect.element(screen.getByLabelText('login.password')).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'login.showPassword' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('link', { name: 'login.forget' })).toHaveFocus()
})

it('associates native email validation with the focused credential field', async () => {
  const screen = await renderForm()
  const email = screen.getByLabelText('login.email')

  await userEvent.fill(email, 'invalid-email')
  await userEvent.fill(screen.getByLabelText('login.password'), 'password')
  await userEvent.click(screen.getByRole('button', { name: 'login.signBtn' }))

  await expect.element(email).toHaveAttribute('aria-invalid', 'true')
  await expect.element(email).toHaveAccessibleDescription('login.error.emailInValid')
  await expect.element(email).toHaveFocus()
  expect(((await email.element()) as HTMLInputElement).validity.typeMismatch).toBe(true)
})

it('does not expose SSO when enforcement has no configured protocol', async () => {
  const screen = await renderForm({
    systemFeatures: {
      sso_enforced_for_signin: true,
      sso_enforced_for_signin_protocol: null,
    },
  })

  await expect
    .element(screen.getByRole('button', { name: 'login.withSSO' }))
    .not.toBeInTheDocument()
})
