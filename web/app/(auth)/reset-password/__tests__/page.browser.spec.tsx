import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/storage'
import { consoleClient } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import ResetPasswordPage from '../page'

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  search: '',
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'forgotPassword.post': vi.fn(),
    }),
  }
})

const sendResetCode = vi.mocked(consoleClient.forgotPassword.post)

async function renderPage() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <ResetPasswordPage />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  navigation.push.mockReset()
  navigation.search = ''
  sendResetCode.mockReset().mockResolvedValue({ result: 'success', data: 'reset-token' })
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
    expect(sendResetCode).toHaveBeenCalledWith({
      body: { email: 'user@example.com', language: 'en-US' },
    }),
  )
  expect(localStorage.getItem(COUNT_DOWN_KEY)).toBe(String(COUNT_DOWN_TIME_MS))
  expect(navigation.push).toHaveBeenCalledWith(
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
  expect(sendResetCode).not.toHaveBeenCalled()

  await userEvent.fill(email, '')
  await userEvent.click(screen.getByRole('button', { name: 'login.sendVerificationCode' }))

  await expect.element(email).toHaveAccessibleDescription('login.error.emailEmpty')
  await expect.element(email).toHaveFocus()
  expect(nativeEmail.validity.valueMissing).toBe(true)
  await expect.element(screen.getByText('login.error.emailInValid')).not.toBeInTheDocument()
  expect(sendResetCode).not.toHaveBeenCalled()
})
