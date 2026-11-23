import type { TestNavigation } from '@/test/next-navigation'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import ForgotPasswordForm from './ForgotPasswordForm'

let navigation: TestNavigation

const fake = setupFakeApi(() => ({
  console: {
    forgotPassword: { post: () => ({ result: 'success', data: 'ok' }) },
    init: { get: () => ({ status: 'finished' }) },
  },
}))

async function renderForm() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  navigation = createTestNavigation({ url: '/forgot-password' })
  const { NavigationProvider } = navigation
  return render(
    <NavigationProvider>
      <ConsoleProvider>
        <ForgotPasswordForm />
      </ConsoleProvider>
    </NavigationProvider>,
  )
}

it('renders the labelled native email form without waiting for the init query', async () => {
  fake.console.init.get.mockReturnValue(new Promise(() => {}))

  const screen = await renderForm()
  const email = screen.getByLabelText('login.email')

  await expect
    .element(screen.getByRole('heading', { level: 1 }))
    .toHaveTextContent('login.forgotPassword')
  await expect.element(email).toHaveAttribute('type', 'email')
  await expect.element(email).toHaveAttribute('autocomplete', 'email')
  await expect.poll(() => document.title).toBe('login.forgotPassword - Dify')
})

it('keeps invalid and missing email errors associated with the focused native field', async () => {
  const screen = await renderForm()
  const email = screen.getByLabelText('login.email')
  const submit = screen.getByRole('button', { name: /login\.sendResetLink/ })

  await userEvent.fill(email, 'test@example')
  await userEvent.click(submit)

  await expect.element(email).toHaveAttribute('aria-invalid', 'true')
  await expect.element(email).toHaveAccessibleDescription('login.error.emailInValid')
  await expect.element(email).toHaveFocus()
  const nativeEmail = (await email.element()) as HTMLInputElement
  expect(nativeEmail.validity.typeMismatch).toBe(false)
  expect(nativeEmail.validity.customError).toBe(true)
  expect(fake.console.forgotPassword.post).not.toHaveBeenCalled()

  await userEvent.fill(email, '')
  await userEvent.click(submit)

  await expect.element(email).toHaveAccessibleDescription('login.error.emailInValid')
  await expect.element(email).toHaveFocus()
  expect(((await email.element()) as HTMLInputElement).validity.valueMissing).toBe(true)
  expect(fake.console.forgotPassword.post).not.toHaveBeenCalled()
})

it('submits with Enter and replaces the form with the sign-in destination', async () => {
  const screen = await renderForm()
  const email = screen.getByLabelText('login.email')

  await userEvent.fill(email, 'test@example.com')
  await userEvent.keyboard('{Enter}')

  await vi.waitFor(() =>
    expect(fake.console.forgotPassword.post).toHaveBeenCalledWith({
      body: { email: 'test@example.com' },
    }),
  )
  await expect
    .element(screen.getByRole('link', { name: /login\.backToSignIn/ }))
    .toHaveAttribute('href', '/signin')
  await expect.element(email).not.toBeInTheDocument()
  await expect.poll(() => document.title).toBe('login.resetLinkSent - Dify')
})

it('prevents a second submission while the reset request is pending', async () => {
  const request = createDeferred<{ result: 'success'; data: string }>()
  fake.console.forgotPassword.post.mockReturnValue(request.promise)
  const screen = await renderForm()
  await userEvent.fill(screen.getByLabelText('login.email'), 'test@example.com')
  const submit = screen.getByRole('button', { name: /login\.sendResetLink/ })

  await userEvent.click(submit)
  await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(screen.getByLabelText('login.email'))
  await userEvent.keyboard('{Enter}')
  await vi.waitFor(() => expect(fake.console.forgotPassword.post).toHaveBeenCalledTimes(1))

  request.resolve({ result: 'success', data: 'ok' })
  await expect.element(screen.getByRole('link', { name: /login\.backToSignIn/ })).toBeVisible()
})

it('keeps the entered email actionable after a failed response', async () => {
  fake.console.forgotPassword.post.mockResolvedValue({ result: 'fail', data: 'error' })
  const screen = await renderForm()
  const email = screen.getByLabelText('login.email')
  const submit = screen.getByRole('button', { name: /login\.sendResetLink/ })

  await userEvent.fill(email, 'test@example.com')
  await userEvent.click(submit)

  await vi.waitFor(() => expect(fake.console.forgotPassword.post).toHaveBeenCalledTimes(1))
  await expect.element(email).toHaveValue('test@example.com')
  await expect.element(submit).not.toHaveAttribute('aria-disabled', 'true')
})

it('redirects an instance that still needs its initial password', async () => {
  fake.console.init.get.mockResolvedValue({ status: 'not_started' })

  await renderForm()

  await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith('/init'))
})
