import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi } from '@/test/fake-api'
import ChangePasswordForm from '../page'

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: 'token=reset-token',
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

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
  return render(
    <ConsoleProvider>
      <ChangePasswordForm />
    </ConsoleProvider>,
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

function installApi() {
  return installFakeApi({
    console: { forgotPassword: { resets: { post: () => ({ result: 'success' }) } } },
  })
}
let fake: ReturnType<typeof installApi>

beforeEach(() => {
  fake = installApi()
  onTestFinished(fake)
  navigation.replace.mockReset()
  navigation.search = 'token=reset-token'
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
    expect(fake.console.forgotPassword.resets.post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          token: 'reset-token',
          new_password: validPassword,
          password_confirm: validPassword,
        },
      }),
    ),
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
    search: `token=reset-token&redirect_url=${encodeURIComponent(redirectUrl)}`,
    href: encodedSigninUrl,
  },
  {
    scenario: 'invite activation',
    search: `token=reset-token&invite_token=invite-token&redirect_url=${encodeURIComponent(redirectUrl)}`,
    href: '/activate?token=invite-token',
  },
  {
    scenario: 'plain sign in',
    search: 'token=reset-token',
    href: '/signin',
  },
])('keeps the $scenario destination on the success link', async ({ search, href }) => {
  navigation.search = search

  const screen = await completePasswordChange()
  const link = screen.getByRole('link', { name: /login\.passwordChanged/ })

  await expect.element(link).toHaveAttribute('href', href)
  await expect.element(link).toHaveAttribute('data-replace', 'true')
})

it('automatically returns to the preserved redirect after the visible countdown', async () => {
  navigation.search = `token=reset-token&redirect_url=${encodeURIComponent(redirectUrl)}`
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  const screen = await completePasswordChange()

  await expect
    .element(screen.getByRole('link', { name: /login\.passwordChanged/ }))
    .toHaveTextContent('login.passwordChanged (5)')
  await vi.advanceTimersByTimeAsync(5000)

  expect(navigation.replace).toHaveBeenCalledWith(encodedSigninUrl)
})
