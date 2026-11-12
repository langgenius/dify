import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleClient } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import ForgotPasswordForm from './ForgotPasswordForm'

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const responses = { 'forgotPassword.post': vi.fn(), 'init.get': vi.fn() }
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, responses),
    consoleQuery: withConsoleResponses(actual.consoleQuery, responses),
  }
})

const sendResetLink = vi.mocked(consoleClient.forgotPassword.post)
const fetchInitStatus = vi.mocked(consoleClient.init.get)

async function renderForm() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <ForgotPasswordForm />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  navigation.replace.mockReset()
  sendResetLink.mockReset()
  fetchInitStatus.mockReset().mockResolvedValue({ status: 'finished' })
})

it('renders the labelled native email form without waiting for the init query', async () => {
  fetchInitStatus.mockReturnValue(new Promise(() => {}))

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
  expect(sendResetLink).not.toHaveBeenCalled()

  await userEvent.fill(email, '')
  await userEvent.click(submit)

  await expect.element(email).toHaveAccessibleDescription('login.error.emailInValid')
  await expect.element(email).toHaveFocus()
  expect(((await email.element()) as HTMLInputElement).validity.valueMissing).toBe(true)
  expect(sendResetLink).not.toHaveBeenCalled()
})

it('submits with Enter and replaces the form with the sign-in destination', async () => {
  sendResetLink.mockResolvedValue({ result: 'success', data: 'ok' })
  const screen = await renderForm()
  const email = screen.getByLabelText('login.email')

  await userEvent.fill(email, 'test@example.com')
  await userEvent.keyboard('{Enter}')

  await vi.waitFor(() =>
    expect(sendResetLink).toHaveBeenCalledWith({ body: { email: 'test@example.com' } }),
  )
  await expect
    .element(screen.getByRole('link', { name: /login\.backToSignIn/ }))
    .toHaveAttribute('href', '/signin')
  await expect.element(email).not.toBeInTheDocument()
  await expect.poll(() => document.title).toBe('login.resetLinkSent - Dify')
})

it('prevents a second submission while the reset request is pending', async () => {
  const request = createDeferred<{ result: 'success'; data: string }>()
  sendResetLink.mockReturnValue(request.promise)
  const screen = await renderForm()
  await userEvent.fill(screen.getByLabelText('login.email'), 'test@example.com')
  const submit = screen.getByRole('button', { name: /login\.sendResetLink/ })

  await userEvent.click(submit)
  await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(screen.getByLabelText('login.email'))
  await userEvent.keyboard('{Enter}')
  expect(sendResetLink).toHaveBeenCalledTimes(1)

  request.resolve({ result: 'success', data: 'ok' })
  await expect.element(screen.getByRole('link', { name: /login\.backToSignIn/ })).toBeVisible()
})

it('keeps the entered email actionable after a failed response', async () => {
  sendResetLink.mockResolvedValue({ result: 'fail', data: 'error' })
  const screen = await renderForm()
  const email = screen.getByLabelText('login.email')
  const submit = screen.getByRole('button', { name: /login\.sendResetLink/ })

  await userEvent.fill(email, 'test@example.com')
  await userEvent.click(submit)

  await vi.waitFor(() => expect(sendResetLink).toHaveBeenCalledTimes(1))
  await expect.element(email).toHaveValue('test@example.com')
  await expect.element(submit).not.toHaveAttribute('aria-disabled', 'true')
})

it('redirects an instance that still needs its initial password', async () => {
  fetchInitStatus.mockResolvedValue({ status: 'not_started' })

  await renderForm()

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/init'))
})
