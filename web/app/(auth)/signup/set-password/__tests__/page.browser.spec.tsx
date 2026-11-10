import Cookies from 'js-cookie'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { getBrowserTimezone } from '@/utils/timezone'
import ChangePasswordForm from '../page'

const tracking = vi.hoisted(() => ({
  rememberCreateAppExternalAttribution: vi.fn(),
  rememberRegistrationSuccess: vi.fn(),
  sendGAEvent: vi.fn(),
}))

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: 'token=register-token',
}))

const requests = vi.hoisted(() => ({
  register: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('@/utils/timezone', () => ({
  getBrowserTimezone: vi.fn(),
}))

vi.mock('@/utils/gtag', () => ({
  sendGAEvent: (...args: unknown[]) => tracking.sendGAEvent(...args),
}))

vi.mock('@/app/components/base/amplitude/registration-tracking', () => ({
  rememberRegistrationSuccess: (...args: unknown[]) =>
    tracking.rememberRegistrationSuccess(...args),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  rememberCreateAppExternalAttribution: (...args: unknown[]) =>
    tracking.rememberCreateAppExternalAttribution(...args),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'emailRegister.post': (input) => requests.register(input),
    }),
  }
})

const validPassword = 'ValidPass123!'

async function renderPage() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <ChangePasswordForm />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  tracking.rememberCreateAppExternalAttribution.mockReset()
  tracking.rememberRegistrationSuccess.mockReset()
  tracking.sendGAEvent.mockReset()
  navigation.replace.mockReset()
  navigation.search = 'token=register-token'
  requests.register.mockReset().mockResolvedValue({ result: 'fail', data: {} })
  vi.mocked(getBrowserTimezone).mockReset().mockReturnValue('Asia/Shanghai')
  Cookies.remove('utm_info')
})

afterEach(() => {
  Cookies.remove('utm_info')
})

it('submits the real locale and browser timezone through the native password form', async () => {
  const screen = await renderPage()
  const password = screen.getByLabelText('accountSettings.account.newPassword')
  const confirmation = screen.getByLabelText('accountSettings.account.confirmPassword')

  await expect.element(password).toHaveAttribute('autocomplete', 'new-password')
  await expect.element(confirmation).toHaveAttribute('autocomplete', 'new-password')
  await userEvent.fill(password, validPassword)
  await userEvent.fill(confirmation, validPassword)
  await userEvent.keyboard('{Enter}')

  await vi.waitFor(() =>
    expect(requests.register).toHaveBeenCalledWith({
      body: {
        token: 'register-token',
        new_password: validPassword,
        password_confirm: validPassword,
        language: 'en-US',
        timezone: 'Asia/Shanghai',
      },
    }),
  )
})

it('revalidates confirmation when the native password value changes', async () => {
  const screen = await renderPage()
  const password = screen.getByLabelText('accountSettings.account.newPassword')
  const confirmation = screen.getByLabelText('accountSettings.account.confirmPassword')

  await userEvent.fill(password, validPassword)
  await userEvent.fill(confirmation, 'DifferentPass123!')
  await userEvent.keyboard('{Enter}')

  await expect.element(confirmation).toHaveAttribute('aria-invalid', 'true')
  await expect.element(confirmation).toHaveAccessibleDescription('accountSettings.account.notEqual')
  await expect.element(confirmation).toHaveFocus()
  expect(requests.register).not.toHaveBeenCalled()

  await userEvent.fill(password, 'DifferentPass123!')

  await expect.element(confirmation).not.toHaveAttribute('aria-invalid', 'true')
  await expect.element(screen.getByText('accountSettings.account.notEqual')).not.toBeInTheDocument()
  expect(requests.register).not.toHaveBeenCalled()
})

it('records successful registration and returns to the console home', async () => {
  requests.register.mockResolvedValue({ result: 'success', data: {} })
  const screen = await renderPage()
  await userEvent.fill(screen.getByLabelText('accountSettings.account.newPassword'), validPassword)
  await userEvent.fill(
    screen.getByLabelText('accountSettings.account.confirmPassword'),
    validPassword,
  )
  await userEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

  await vi.waitFor(() =>
    expect(tracking.rememberRegistrationSuccess).toHaveBeenCalledWith({
      method: 'email',
      utmInfo: null,
    }),
  )
  expect(tracking.rememberCreateAppExternalAttribution).toHaveBeenCalledWith({ utmInfo: null })
  expect(tracking.sendGAEvent).toHaveBeenCalledWith('user_registration_success', {
    method: 'email',
  })
  expect(navigation.replace).toHaveBeenCalledWith('/')
})

it('returns to a requested console page after registration', async () => {
  navigation.search = 'token=register-token&redirect_url=%2Fapps%3Ftag%3Dworkflow'
  requests.register.mockResolvedValue({ result: 'success', data: {} })
  const screen = await renderPage()
  await userEvent.fill(screen.getByLabelText('accountSettings.account.newPassword'), validPassword)
  await userEvent.fill(
    screen.getByLabelText('accountSettings.account.confirmPassword'),
    validPassword,
  )
  await userEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/apps?tag=workflow'))
})

it('records UTM attribution and clears its browser cookie after registration', async () => {
  Cookies.set('utm_info', JSON.stringify({ utm_source: 'community', slug: 'partner-launch' }))
  requests.register.mockResolvedValue({ result: 'success', data: {} })
  const screen = await renderPage()
  await userEvent.fill(screen.getByLabelText('accountSettings.account.newPassword'), validPassword)
  await userEvent.fill(
    screen.getByLabelText('accountSettings.account.confirmPassword'),
    validPassword,
  )
  await userEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

  await vi.waitFor(() =>
    expect(tracking.rememberRegistrationSuccess).toHaveBeenCalledWith({
      method: 'email',
      utmInfo: { utm_source: 'community', slug: 'partner-launch' },
    }),
  )
  expect(tracking.rememberCreateAppExternalAttribution).toHaveBeenCalledWith({
    utmInfo: { utm_source: 'community', slug: 'partner-launch' },
  })
  expect(tracking.sendGAEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
    method: 'email',
    utm_source: 'community',
    slug: 'partner-launch',
  })
  expect(Cookies.get('utm_info')).toBeUndefined()
})
