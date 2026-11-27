import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createTestNavigation } from '@/test/next-navigation'
import NormalForm from '../normalForm'

async function renderForm() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: {
      deployment_edition: 'CLOUD',
      sso_enforced_for_signin: false,
      sso_enforced_for_signin_protocol: null,
      enable_social_oauth_login: false,
      enable_email_code_login: true,
      enable_email_password_login: true,
      is_email_setup: true,
      branding: { enabled: true },
      license: { status: 'active' },
    },
  })
  const { NavigationProvider } = createTestNavigation({
    url: '/webapp-signin?redirect_url=%2Fchatbot%2Fshare-app',
  })
  return render(
    <NavigationProvider>
      <ConsoleProvider>
        <NormalForm />
      </ConsoleProvider>
    </NavigationProvider>,
  )
}

it('switches the real password and verification-code forms without losing trigger focus', async () => {
  const screen = await renderForm()
  const switchToCode = screen.getByRole('button', { name: 'login.useVerificationCode' })

  await expect.element(screen.getByLabelText('login.email')).toBeVisible()
  await expect.element(screen.getByLabelText('login.password')).toBeVisible()

  await userEvent.click(switchToCode)
  const switchToPassword = screen.getByRole('button', { name: 'login.usePassword' })
  await expect.element(switchToPassword).toHaveFocus()
  await expect
    .element(screen.getByRole('button', { name: 'login.signup.verifyMail' }))
    .toBeVisible()
  await expect.element(screen.getByLabelText('login.password')).not.toBeInTheDocument()

  await userEvent.keyboard('{Enter}')
  await expect.element(switchToCode).toHaveFocus()
  await expect.element(screen.getByLabelText('login.password')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'login.signup.verifyMail' }))
    .not.toBeInTheDocument()
})
