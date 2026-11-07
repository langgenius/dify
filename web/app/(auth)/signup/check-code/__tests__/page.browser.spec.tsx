import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/storage'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import CheckCode from '../page'

const requests = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  verifyCode: vi.fn(),
}))

const navigation = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  search: 'email=user%40example.com&token=signup-token',
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    back: navigation.back,
    push: navigation.push,
    replace: navigation.replace,
  }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'emailRegister.sendEmail.post': (input) => requests.sendEmail(input),
      'emailRegister.validity.post': (input) => requests.verifyCode(input),
    }),
  }
})

async function renderPage() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <CheckCode />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  requests.sendEmail.mockReset()
  requests.verifyCode.mockReset().mockResolvedValue({
    is_valid: true,
    token: 'verified-token',
  })
  navigation.back.mockReset()
  navigation.push.mockReset()
  navigation.replace.mockReset()
  navigation.search = 'email=user%40example.com&token=signup-token'
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
    expect(requests.verifyCode).toHaveBeenCalledWith({
      body: {
        code: '123456',
        email: 'user@example.com',
        token: 'signup-token',
      },
    }),
  )
  expect(requests.verifyCode).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1))
  const destination = new URL(navigation.push.mock.calls[0]![0], window.location.origin)
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
  expect(requests.verifyCode).not.toHaveBeenCalled()
})
