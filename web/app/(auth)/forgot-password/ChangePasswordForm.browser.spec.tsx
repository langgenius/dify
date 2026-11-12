import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleClient } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import ChangePasswordForm from './ChangePasswordForm'

const navigation = vi.hoisted(() => ({
  search: 'token=url-token-t1',
}))

const requests = vi.hoisted(() => ({
  verifyToken: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('@/service/base', () => ({ post: requests.verifyToken }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'forgotPassword.resets.post': vi.fn(),
    }),
  }
})

const changePassword = vi.mocked(consoleClient.forgotPassword.resets.post)
const validPassword = 'ValidPass123!'

async function renderForm() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <ChangePasswordForm />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  navigation.search = 'token=url-token-t1'
  requests.verifyToken.mockReset().mockResolvedValue({
    result: 'success',
    is_valid: true,
    email: 'user@example.com',
    token: 'verified-token-t2',
  })
  changePassword.mockReset().mockResolvedValue({ result: 'success' })
})

it('keeps the real token query pending before showing the password form', async () => {
  const verification = createDeferred<{
    result: string
    is_valid: boolean
    email: string
    token: string
  }>()
  requests.verifyToken.mockReturnValue(verification.promise)

  const screen = await renderForm()

  await expect.poll(() => document.title).toBe('common.loading - Dify')
  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.changePassword' }))
    .not.toBeInTheDocument()
  expect(requests.verifyToken).toHaveBeenCalledWith('/forgot-password/validity', {
    body: { token: 'url-token-t1' },
  })

  verification.resolve({
    result: 'success',
    is_valid: false,
    email: '',
    token: '',
  })
  await expect.element(screen.getByRole('heading', { name: 'login.invalid' })).toBeVisible()
})

it('submits the verified token through the native password form', async () => {
  const screen = await renderForm()
  const password = screen.getByLabelText('accountSettings.account.newPassword')
  const confirmation = screen.getByLabelText('accountSettings.account.confirmPassword')

  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.changePassword' }))
    .toBeVisible()
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
    expect(changePassword).toHaveBeenCalledWith({
      body: {
        token: 'verified-token-t2',
        new_password: validPassword,
        password_confirm: validPassword,
      },
    }),
  )
  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.passwordChangedTip' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('link', { name: 'login.passwordChanged' }))
    .toHaveAttribute('href', '/signin')
  await expect.poll(() => document.title).toBe('login.passwordChangedTip - Dify')
})

it('replaces invalid and missing password errors on the same focused field', async () => {
  const screen = await renderForm()
  const password = screen.getByLabelText('accountSettings.account.newPassword')
  const submit = screen.getByRole('button', { name: /common\.operation\.reset/ })

  await userEvent.fill(password, 'weak')
  await userEvent.click(submit)

  await expect.element(password).toHaveAttribute('aria-invalid', 'true')
  await expect.element(password).toHaveAccessibleDescription('login.error.passwordInvalid')
  await expect.element(password).toHaveFocus()
  const nativePassword = (await password.element()) as HTMLInputElement
  expect(nativePassword.validity.patternMismatch).toBe(false)
  expect(nativePassword.validity.customError).toBe(true)
  expect(changePassword).not.toHaveBeenCalled()

  await userEvent.fill(password, '')
  await userEvent.click(submit)

  await expect.element(password).toHaveAccessibleDescription('login.error.passwordEmpty')
  await expect.element(password).toHaveFocus()
  expect(((await password.element()) as HTMLInputElement).validity.valueMissing).toBe(true)
  await expect.element(screen.getByText('login.error.passwordInvalid')).not.toBeInTheDocument()
  expect(changePassword).not.toHaveBeenCalled()
})

it('revalidates confirmation when the native password value changes', async () => {
  const screen = await renderForm()
  const password = screen.getByLabelText('accountSettings.account.newPassword')
  const confirmation = screen.getByLabelText('accountSettings.account.confirmPassword')

  await userEvent.fill(password, validPassword)
  await userEvent.fill(confirmation, 'DifferentPass123!')
  await userEvent.keyboard('{Enter}')

  await expect.element(confirmation).toHaveAttribute('aria-invalid', 'true')
  await expect.element(confirmation).toHaveAccessibleDescription('accountSettings.account.notEqual')
  await expect.element(confirmation).toHaveFocus()
  expect(changePassword).not.toHaveBeenCalled()

  await userEvent.fill(password, 'DifferentPass123!')

  await expect.element(confirmation).not.toHaveAttribute('aria-invalid', 'true')
  await expect.element(screen.getByText('accountSettings.account.notEqual')).not.toBeInTheDocument()
  expect(changePassword).not.toHaveBeenCalled()
})

it('prevents a second submission while the password change is pending', async () => {
  const request = createDeferred<{ result: 'success' }>()
  changePassword.mockReturnValue(request.promise)
  const screen = await renderForm()
  await userEvent.fill(screen.getByLabelText('accountSettings.account.newPassword'), validPassword)
  await userEvent.fill(
    screen.getByLabelText('accountSettings.account.confirmPassword'),
    validPassword,
  )
  const submit = screen.getByRole('button', { name: /common\.operation\.reset/ })

  await userEvent.click(submit)
  await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(screen.getByLabelText('accountSettings.account.newPassword'))
  await userEvent.keyboard('{Enter}')
  expect(changePassword).toHaveBeenCalledTimes(1)

  request.resolve({ result: 'success' })
  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.passwordChangedTip' }))
    .toBeVisible()
})

it('shows the invalid-token state after the real token query settles', async () => {
  requests.verifyToken.mockResolvedValue({
    result: 'success',
    is_valid: false,
    email: '',
    token: '',
  })

  const screen = await renderForm()

  await expect
    .element(screen.getByRole('heading', { level: 1, name: 'login.invalid' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: /common\.operation\.reset/ }))
    .not.toBeInTheDocument()
  await expect.poll(() => document.title).toBe('login.invalid - Dify')
})
