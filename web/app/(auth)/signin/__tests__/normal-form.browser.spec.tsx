import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { DeepPartial } from '@/test/console/system-features'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { createHttpError } from '@/service/http-error'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import NormalForm from '../normal-form'

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: '',
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

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
  if (invitation) queryClient.setQueryData(['signin', 'invite-check', 'invite-token'], invitation)

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
  },
}

beforeEach(() => {
  navigation.replace.mockReset()
  navigation.search = ''
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

it('redirects the matching logged-in account to invitation settings case-insensitively', async () => {
  navigation.search = 'invite_token=invite-token'

  await renderForm({
    profile: { id: 'account-id', email: 'Invitee@Example.com' },
    invitation,
  })

  await vi.waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith(
      '/signin/invite-settings?invite_token=invite-token',
    ),
  )
})

it('keeps a different logged-in account on the invitation sign-in form', async () => {
  navigation.search = 'invite_token=invite-token'

  const screen = await renderForm({
    profile: { id: 'account-id', email: 'current@example.com' },
    invitation,
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
