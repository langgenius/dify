import type { TestNavigation } from '@/test/next-navigation'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/storage'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import ResetPasswordPage from '../page'

let navigation: TestNavigation

async function renderPage() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  navigation = createTestNavigation({ url: '/reset-password' })
  const { NavigationProvider } = navigation
  return render(
    <NavigationProvider>
      <ConsoleProvider>
        <ResetPasswordPage />
      </ConsoleProvider>
    </NavigationProvider>,
  )
}

const fake = setupFakeApi(() => ({
  console: { forgotPassword: { post: () => ({ result: 'success', data: 'reset-token' }) } },
}))

beforeEach(() => {
  localStorage.removeItem(COUNT_DOWN_KEY)
})

afterEach(() => {
  localStorage.removeItem(COUNT_DOWN_KEY)
})

it('submits the labelled email form with Enter and preserves the reset session', async () => {
  const screen = await renderPage()
  const email = screen.getByRole('textbox', { name: 'login.email' })

  await expect.element(email).toHaveAttribute('autocomplete', 'email')
  await userEvent.fill(email, 'user@example.com')
  await userEvent.keyboard('{Enter}')

  await vi.waitFor(() =>
    expect(fake.console.forgotPassword.post).toHaveBeenCalledWith({
      body: { email: 'user@example.com', language: 'en-US' },
    }),
  )
  await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalled())
  expect(localStorage.getItem(COUNT_DOWN_KEY)).toBe(String(COUNT_DOWN_TIME_MS))
  expect(navigation.router.push).toHaveBeenCalledWith(
    '/reset-password/check-code?token=reset-token&email=user%2540example.com',
  )
})

it('replaces an invalid-email error with the required error on the same focused field', async () => {
  const screen = await renderPage()
  const email = screen.getByRole('textbox', { name: 'login.email' })

  await userEvent.fill(email, 'invalid-email')
  await userEvent.keyboard('{Enter}')

  await expect.element(email).toHaveAttribute('aria-invalid', 'true')
  await expect.element(email).toHaveAccessibleDescription('login.error.emailInValid')
  await expect.element(email).toHaveFocus()
  const nativeEmail = (await email.element()) as HTMLInputElement
  expect(nativeEmail.validity.typeMismatch).toBe(true)
  expect(fake.console.forgotPassword.post).not.toHaveBeenCalled()

  await userEvent.fill(email, '')
  await userEvent.click(screen.getByRole('button', { name: 'login.sendVerificationCode' }))

  await expect.element(email).toHaveAccessibleDescription('login.error.emailEmpty')
  await expect.element(email).toHaveFocus()
  expect(nativeEmail.validity.valueMissing).toBe(true)
  await expect.element(screen.getByText('login.error.emailInValid')).not.toBeInTheDocument()
  expect(fake.console.forgotPassword.post).not.toHaveBeenCalled()
})
