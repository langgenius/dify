import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { DeepPartial } from '@/test/console/system-features'
import type { TestNavigation } from '@/test/next-navigation'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { createHttpError } from '@/service/http-error'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { createTestNavigation } from '@/test/next-navigation'
import NormalForm from '../normal-form'

let search = ''
let navigation: TestNavigation

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
    account_status?: string
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
    // Seed the settled 401 instead of serving it: a served 401 triggers the token refresh, and its
    // failure redirects the page to /signin, which only an end-to-end run can follow.
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
  if (invitation) queryClient.setQueryData(['signin', 'invite-check', 'invite-token'], invitation)

  navigation = createTestNavigation({ url: `/signin?${search}` })
  const { NavigationProvider } = navigation
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    queryClient,
    accountProfile: null,
    systemFeatures,
  })
  return render(
    <NavigationProvider>
      <ConsoleProvider>
        <NormalForm />
      </ConsoleProvider>
    </NavigationProvider>,
  )
}

const invitation: InvitationData = {
  is_valid: true,
  data: {
    workspace_name: 'Acme',
    workspace_id: 'workspace-id',
    email: 'invitee@example.com',
  },
}

beforeEach(() => {
  search = ''
})

it('renders the native sign-in controls while the login probe is pending', async () => {
  const screen = await renderForm({ profile: 'pending' })
  const email = screen.getByLabelText('login.email')
  const password = screen.getByLabelText('login.password')

  await expect.element(screen.getByRole('heading', { level: 1 })).toBeVisible()
  await expect.element(email).toHaveAttribute('type', 'email')
  await expect.element(email).toHaveAttribute('autocomplete', 'email')
  await expect.element(password).toHaveAttribute('type', 'password')
  expect(navigation.router.replace).not.toHaveBeenCalled()

  const reveal = screen.getByRole('button', { name: 'login.showPassword' })
  await userEvent.click(reveal)
  await expect.element(reveal).toHaveAttribute('aria-pressed', 'true')
  await expect.element(password).toHaveAttribute('type', 'text')
})

it.each([
  { scenario: 'no requested destination', query: '' },
  {
    scenario: 'an external requested destination',
    query: 'redirect_url=https%3A%2F%2Fgoogle.com',
  },
])('redirects a logged-in visitor with $scenario to the console home', async ({ query }) => {
  search = query

  await renderForm({ profile: { id: 'account-id', email: 'invitee@example.com' } })

  await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/'))
})

it('redirects the matching logged-in account to invitation settings case-insensitively', async () => {
  search = 'invite_token=invite-token'

  await renderForm({
    profile: { id: 'account-id', email: 'Invitee@Example.com' },
    invitation,
  })

  await vi.waitFor(() =>
    expect(navigation.router.replace).toHaveBeenCalledWith(
      '/signin/invite-settings?invite_token=invite-token',
    ),
  )
})

it('keeps a different logged-in account on the invitation sign-in form', async () => {
  search = 'invite_token=invite-token'

  const screen = await renderForm({
    profile: { id: 'account-id', email: 'current@example.com' },
    invitation,
  })

  await expect.element(screen.getByRole('button', { name: 'login.signBtn' })).toBeVisible()
  expect(navigation.router.replace).not.toHaveBeenCalled()
})

it('asks a newly invited account to set a password instead of signing in', async () => {
  search = 'invite_token=invite-token'

  const screen = await renderForm({
    invitation: { ...invitation, data: { ...invitation.data, account_status: 'pending' } },
    systemFeatures: { is_email_setup: true },
  })
  const password = screen.getByLabelText('accountSettings.account.newPassword')

  await expect
    .element(screen.getByRole('button', { name: 'login.signup.createAccount' }))
    .toBeVisible()
  await expect.element(password).toHaveAttribute('autocomplete', 'new-password')
  await expect.element(screen.getByText('login.error.passwordInvalid')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'login.signBtn' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('link', { name: 'login.forget' })).not.toBeInTheDocument()
})

it('keeps the sign-in form for an invited account that already has a password', async () => {
  search = 'invite_token=invite-token'

  const screen = await renderForm({
    invitation: { ...invitation, data: { ...invitation.data, account_status: 'active' } },
    systemFeatures: { is_email_setup: true },
  })

  await expect.element(screen.getByRole('button', { name: 'login.signBtn' })).toBeVisible()
  await expect
    .element(screen.getByLabelText('login.password'))
    .toHaveAttribute('autocomplete', 'current-password')
  await expect.element(screen.getByRole('link', { name: 'login.forget' })).toBeVisible()
})

it('preserves the current query when navigating to sign up', async () => {
  search = 'redirect_url=%2Fapps%3Ftag%3Dworkflow&source=pricing'

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
