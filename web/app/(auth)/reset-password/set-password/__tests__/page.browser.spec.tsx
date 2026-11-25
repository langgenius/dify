import type { TestNavigation } from '@/test/next-navigation'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import ChangePasswordForm from '../page'

let search = 'token=reset-token'
let navigation: TestNavigation

vi.mock('@/next/link', () => ({
  default: ({ children, replace, ...props }: React.ComponentProps<'a'> & { replace?: boolean }) => (
    <a {...props} data-replace={replace || undefined}>
      {children}
    </a>
  ),
}))

const validPassword = 'ValidPass123!'
const redirectUrl = '/apps?template-id=template-1&utm_source=dify_blog'
const encodedSigninUrl =
  '/signin?redirect_url=%2Fapps%3Ftemplate-id%3Dtemplate-1%26utm_source%3Ddify_blog'

async function renderPage(systemTitle?: string) {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper(
    systemTitle
      ? { systemFeatures: { branding: { enabled: true, application_title: systemTitle } } }
      : {},
  )
  navigation = createTestNavigation({ url: `/reset-password/set-password?${search}` })
  const { NavigationProvider } = navigation
  return render(
    <NavigationProvider>
      <ConsoleProvider>
        <ChangePasswordForm />
      </ConsoleProvider>
    </NavigationProvider>,
  )
}

async function completePasswordChange() {
  const screen = await renderPage()
  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.changePassword' }))
    .toBeVisible()
  await userEvent.fill(screen.getByLabelText('accountSettings.account.newPassword'), validPassword)
  await userEvent.fill(
    screen.getByLabelText('accountSettings.account.confirmPassword'),
    validPassword,
  )
  await userEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))
  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.passwordChangedTip' }))
    .toBeVisible()
  return screen
}

const fake = setupFakeApi(() => ({
  console: { forgotPassword: { resets: { post: () => ({ result: 'success' }) } } },
}))

beforeEach(() => {
  search = 'token=reset-token'
})

afterEach(() => {
  vi.useRealTimers()
})

it('uses live client branding for the initial route title', async () => {
  await renderPage('Acme')

  await expect.poll(() => document.title).toBe('login.changePassword - Acme')
})

it('reveals the native password input and submits the form with Enter', async () => {
  const screen = await renderPage()
  const password = screen.getByLabelText('accountSettings.account.newPassword')
  const confirmation = screen.getByLabelText('accountSettings.account.confirmPassword')

  await expect.element(password).toHaveAttribute('autocomplete', 'new-password')
  await expect.element(confirmation).toHaveAttribute('autocomplete', 'new-password')
  await userEvent.fill(password, validPassword)
  const reveal = screen.getByRole('button', { name: 'login.showPassword' }).nth(0)
  await userEvent.click(reveal)

  await expect.element(password).toHaveAttribute('type', 'text')
  await expect.element(reveal).toHaveAttribute('aria-pressed', 'true')
  await userEvent.fill(confirmation, validPassword)
  await userEvent.keyboard('{Enter}')

  await vi.waitFor(() =>
    expect(fake.console.forgotPassword.resets.post).toHaveBeenCalledWith({
      body: {
        token: 'reset-token',
        new_password: validPassword,
        password_confirm: validPassword,
      },
    }),
  )
  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.passwordChangedTip' }))
    .toBeVisible()
  await expect.poll(() => document.title).toBe('login.passwordChangedTip - Dify')
})

it('revalidates the confirmation field as the native password value changes', async () => {
  const screen = await renderPage()
  const password = screen.getByLabelText('accountSettings.account.newPassword')
  const confirmation = screen.getByLabelText('accountSettings.account.confirmPassword')

  await userEvent.fill(password, validPassword)
  await userEvent.fill(confirmation, 'DifferentPass123!')
  await userEvent.keyboard('{Enter}')

  await expect.element(confirmation).toHaveAttribute('aria-invalid', 'true')
  await expect.element(confirmation).toHaveAccessibleDescription('accountSettings.account.notEqual')
  await expect.element(confirmation).toHaveFocus()
  expect(fake.console.forgotPassword.resets.post).not.toHaveBeenCalled()

  await userEvent.fill(password, 'DifferentPass123!')

  await expect.element(confirmation).not.toHaveAttribute('aria-invalid', 'true')
  await expect.element(screen.getByText('accountSettings.account.notEqual')).not.toBeInTheDocument()
  expect(fake.console.forgotPassword.resets.post).not.toHaveBeenCalled()
})

it.each([
  {
    scenario: 'redirect target',
    query: `token=reset-token&redirect_url=${encodeURIComponent(redirectUrl)}`,
    href: encodedSigninUrl,
  },
  {
    scenario: 'invite activation',
    query: `token=reset-token&invite_token=invite-token&redirect_url=${encodeURIComponent(redirectUrl)}`,
    href: '/activate?token=invite-token',
  },
  {
    scenario: 'plain sign in',
    query: 'token=reset-token',
    href: '/signin',
  },
])('keeps the $scenario destination on the success link', async ({ query, href }) => {
  search = query

  const screen = await completePasswordChange()
  const link = screen.getByRole('link', { name: /login\.passwordChanged/ })

  await expect.element(link).toHaveAttribute('href', href)
  await expect.element(link).toHaveAttribute('data-replace', 'true')
})

it('automatically returns to the preserved redirect after the visible countdown', async () => {
  search = `token=reset-token&redirect_url=${encodeURIComponent(redirectUrl)}`
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  const screen = await completePasswordChange()

  await expect
    .element(screen.getByRole('link', { name: /login\.passwordChanged/ }))
    .toHaveTextContent('login.passwordChanged (5)')
  await vi.advanceTimersByTimeAsync(5000)

  expect(navigation.router.replace).toHaveBeenCalledWith(encodedSigninUrl)
})
