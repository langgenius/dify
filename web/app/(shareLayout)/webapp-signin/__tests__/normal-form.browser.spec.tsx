import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import NormalForm from '../normalForm'

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: () => ({
      deployment_edition: 'CLOUD',
      sso_enforced_for_signin: false,
      sso_enforced_for_signin_protocol: null,
      enable_social_oauth_login: false,
      enable_email_code_login: true,
      enable_email_password_login: true,
      is_email_setup: true,
      branding: { enabled: true },
      license: { status: 'active' },
    }),
  }),
}))
vi.mock('../components/mail-and-code-auth', () => ({ default: () => <p>code form</p> }))
vi.mock('../components/mail-and-password-auth', () => ({ default: () => <p>password form</p> }))
vi.mock('../components/sso-auth', () => ({ default: () => null }))

it('switches between password and verification code from the keyboard without losing focus', async () => {
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <NormalForm />
    </QueryClientProvider>,
  )

  await expect.element(screen.getByText('password form')).toBeVisible()

  await userEvent.tab()
  await expect
    .element(screen.getByRole('button', { name: 'login.useVerificationCode' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('code form')).toBeVisible()

  await expect.element(screen.getByRole('button', { name: 'login.usePassword' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('password form')).toBeVisible()
})
