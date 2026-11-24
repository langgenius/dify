import type { TestNavigation } from '@/test/next-navigation'
import Cookies from 'js-cookie'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { emulateTimezone } from '@/test/browser-media-emulation'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import ChangePasswordForm from '../page'

const tracking = vi.hoisted(() => ({
  rememberCreateAppExternalAttribution: vi.fn(),
  rememberRegistrationSuccess: vi.fn(),
  sendGAEvent: vi.fn(),
}))

let search = 'token=register-token'
let navigation: TestNavigation

// boundary: analytics stops at the Google tag adapter.
vi.mock('@/utils/gtag', () => ({
  sendGAEvent: (...args: unknown[]) => tracking.sendGAEvent(...args),
}))

// boundary: analytics stops at the Amplitude registration adapter.
vi.mock('@/app/components/base/amplitude/registration-tracking', () => ({
  rememberRegistrationSuccess: (...args: unknown[]) =>
    tracking.rememberRegistrationSuccess(...args),
}))

// boundary: attribution tracking stops at its storage adapter.
vi.mock('@/utils/create-app-tracking', () => ({
  rememberCreateAppExternalAttribution: (...args: unknown[]) =>
    tracking.rememberCreateAppExternalAttribution(...args),
}))

const validPassword = 'ValidPass123!'
const tokens = { access_token: 'access', csrf_token: 'csrf', refresh_token: 'refresh' }

async function renderPage() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  navigation = createTestNavigation({ url: `/signup/set-password?${search}` })
  const { NavigationProvider } = navigation
  return render(
    <NavigationProvider>
      <ConsoleProvider>
        <ChangePasswordForm />
      </ConsoleProvider>
    </NavigationProvider>,
  )
}

const fake = setupFakeApi(() => ({
  console: { emailRegister: { post: () => ({ result: 'fail', data: tokens }) } },
}))

beforeEach(async () => {
  // Pin the browser's own timezone so the submitted profile is deterministic.
  await emulateTimezone('Asia/Shanghai')
  tracking.rememberCreateAppExternalAttribution.mockReset()
  tracking.rememberRegistrationSuccess.mockReset()
  tracking.sendGAEvent.mockReset()
  search = 'token=register-token'
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
    expect(fake.console.emailRegister.post).toHaveBeenCalledWith({
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
  expect(fake.console.emailRegister.post).not.toHaveBeenCalled()

  await userEvent.fill(password, 'DifferentPass123!')

  await expect.element(confirmation).not.toHaveAttribute('aria-invalid', 'true')
  await expect.element(screen.getByText('accountSettings.account.notEqual')).not.toBeInTheDocument()
  expect(fake.console.emailRegister.post).not.toHaveBeenCalled()
})

it('records successful registration and returns to the console home', async () => {
  fake.console.emailRegister.post.mockResolvedValue({ result: 'success', data: tokens })
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
  expect(navigation.router.replace).toHaveBeenCalledWith('/')
})

it('returns to a requested console page after registration', async () => {
  search = 'token=register-token&redirect_url=%2Fapps%3Ftag%3Dworkflow'
  fake.console.emailRegister.post.mockResolvedValue({ result: 'success', data: tokens })
  const screen = await renderPage()
  await userEvent.fill(screen.getByLabelText('accountSettings.account.newPassword'), validPassword)
  await userEvent.fill(
    screen.getByLabelText('accountSettings.account.confirmPassword'),
    validPassword,
  )
  await userEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

  await vi.waitFor(() =>
    expect(navigation.router.replace).toHaveBeenCalledWith('/apps?tag=workflow'),
  )
})

it('records UTM attribution and clears its browser cookie after registration', async () => {
  Cookies.set('utm_info', JSON.stringify({ utm_source: 'community', slug: 'partner-launch' }))
  fake.console.emailRegister.post.mockResolvedValue({ result: 'success', data: tokens })
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
