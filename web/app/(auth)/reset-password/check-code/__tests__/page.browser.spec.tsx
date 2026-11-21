import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/storage'
import { consoleClient } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import CheckCodePage from '../page'

const navigation = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  search: 'email=user%40example.com&token=email-token',
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
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'forgotPassword.post': vi.fn(),
      'forgotPassword.validity.post': vi.fn(),
    }),
  }
})

const verifyCode = vi.mocked(consoleClient.forgotPassword.validity.post)

async function renderPage() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <CheckCodePage />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  navigation.back.mockReset()
  navigation.push.mockReset()
  navigation.replace.mockReset()
  navigation.search = 'email=user%40example.com&token=email-token'
  verifyCode.mockReset().mockResolvedValue({
    email: 'user@example.com',
    is_valid: true,
    token: 'verified-token',
  })
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
  await expect.element(code).toHaveAttribute('inputmode', 'numeric')
  await expect.element(code).toHaveAttribute('autocomplete', 'one-time-code')
  await userEvent.fill(code, '123456')
  await userEvent.keyboard('{Enter}')

  await vi.waitFor(() =>
    expect(verifyCode).toHaveBeenCalledWith({
      body: {
        code: '123456',
        email: 'user@example.com',
        token: 'email-token',
      },
    }),
  )
  expect(navigation.push).toHaveBeenCalledWith(
    '/reset-password/set-password?email=user%40example.com&token=verified-token',
  )
})

it('keeps native pattern failure associated with the focused code field', async () => {
  const screen = await renderPage()
  const code = screen.getByRole('textbox', {
    name: 'login.checkCode.verificationCode',
  })

  await userEvent.fill(code, '123')
  await userEvent.keyboard('{Enter}')

  await expect.element(code).toHaveAttribute('aria-invalid', 'true')
  await expect.element(code).toHaveAccessibleDescription('login.checkCode.invalidCode')
  await expect.element(code).toHaveFocus()
  expect(((await code.element()) as HTMLInputElement).validity.patternMismatch).toBe(true)
  expect(verifyCode).not.toHaveBeenCalled()
})
