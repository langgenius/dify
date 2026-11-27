import type { TestNavigation } from '@/test/next-navigation'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/storage'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import CheckCode from '../page'

let navigation: TestNavigation

async function renderPage() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  navigation = createTestNavigation({
    url: '/signup/check-code?email=user%40example.com&token=signup-token',
  })
  const { NavigationProvider } = navigation
  return render(
    <NavigationProvider>
      <ConsoleProvider>
        <CheckCode />
      </ConsoleProvider>
    </NavigationProvider>,
  )
}

const fake = setupFakeApi(() => ({
  console: {
    emailRegister: {
      validity: {
        post: () => ({ email: 'user@example.com', is_valid: true, token: 'verified-token' }),
      },
    },
  },
}))

beforeEach(() => {
  localStorage.setItem(COUNT_DOWN_KEY, String(COUNT_DOWN_TIME_MS))
})

afterEach(() => {
  localStorage.removeItem(COUNT_DOWN_KEY)
})

it('focuses the one-time code field and submits the native form with Enter', async () => {
  const screen = await renderPage()
  const code = screen.getByRole('textbox', {
    name: 'login.checkCode.verificationCode',
  })

  await expect.element(code).toHaveFocus()
  await expect.element(code).toHaveAttribute('name', 'code')
  await expect.element(code).toHaveAttribute('inputmode', 'numeric')
  await expect.element(code).toHaveAttribute('autocomplete', 'one-time-code')
  await expect
    .element(screen.getByRole('button', { name: 'login.checkCode.verify' }))
    .toHaveAttribute('type', 'submit')

  await userEvent.fill(code, '123456')
  await userEvent.keyboard('{Enter}')

  await vi.waitFor(() =>
    expect(fake.console.emailRegister.validity.post).toHaveBeenCalledWith({
      body: {
        code: '123456',
        email: 'user@example.com',
        token: 'signup-token',
      },
    }),
  )
  expect(fake.console.emailRegister.validity.post).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledTimes(1))
  const destination = new URL(navigation.router.push.mock.calls[0]![0], window.location.origin)
  expect(destination.pathname).toBe('/signup/set-password')
  expect(destination.searchParams.get('email')).toBe('user@example.com')
  expect(destination.searchParams.get('token')).toBe('verified-token')
})

it('keeps native pattern failure associated with the focused code field', async () => {
  const screen = await renderPage()
  const code = screen.getByRole('textbox', {
    name: 'login.checkCode.verificationCode',
  })

  await userEvent.fill(code, '12345')
  await userEvent.keyboard('{Enter}')

  await expect.element(code).toHaveAttribute('aria-invalid', 'true')
  await expect.element(code).toHaveAccessibleDescription('login.checkCode.invalidCode')
  await expect.element(code).toHaveFocus()
  expect(((await code.element()) as HTMLInputElement).validity.patternMismatch).toBe(true)
  expect(fake.console.emailRegister.validity.post).not.toHaveBeenCalled()
})
