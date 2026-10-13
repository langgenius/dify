import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import WebAppPasswordLogin from '@/app/(shareLayout)/webapp-signin/components/mail-and-password-auth'
import { toast } from '@/app/notifications'
import ConsolePasswordLogin from '@/app/signin/components/mail-and-password-auth'

const navigation = vi.hoisted(() => ({ replace: vi.fn() }))
const searchParams = new URLSearchParams({ redirect_url: '/chatbot/test-app' })

vi.mock('@/next/navigation', () => ({
  useRouter: () => navigation,
  useSearchParams: () => searchParams,
}))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'en-US',
}))
vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: { embeddedUserId: string }) => unknown) =>
    selector({ embeddedUserId: '' }),
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

// Keep the forms, auth request owner, and HTTP normalization real.
// Only the network boundary returns a failed Response.
describe.each(['console', 'webapp'])('%s password login failures', (surface) => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/signin')
  })

  const fillLogin = async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        {surface === 'console' ? (
          <ConsolePasswordLogin isEmailSetup isInvite={false} />
        ) : (
          <WebAppPasswordLogin isEmailSetup />
        )}
      </QueryClientProvider>,
    )
    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')
    await user.type(screen.getByLabelText('login.password'), 'valid-password')
    return { user, submit: screen.getByRole('button', { name: 'login.signBtn' }) }
  }

  it.each([429, 503])(
    'reports HTTP %s once and keeps credentials available for retry',
    async (status) => {
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () =>
          Response.json(
            { code: 'temporarily_unavailable', message: 'Please retry later' },
            { status },
          ),
        )
      const { user, submit } = await fillLogin()
      await user.click(submit)

      await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Please retry later'))
      expect(screen.getByRole('textbox', { name: 'login.email' })).toHaveValue('user@example.com')
      expect(screen.getByLabelText('login.password')).toHaveValue('valid-password')
      expect(submit).toBeEnabled()
      expect(navigation.replace).not.toHaveBeenCalled()

      await user.click(submit)
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      expect(toast.error).toHaveBeenCalledTimes(2)
    },
  )

  it('keeps the authentication-specific message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { code: 'authentication_failed', message: 'Invalid credentials' },
        { status: 401 },
      ),
    )
    const { user, submit } = await fillLogin()
    await user.click(submit)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        surface === 'console' ? 'login.error.invalidEmailOrPassword' : 'Invalid credentials',
      ),
    )
    expect(submit).toBeEnabled()
  })

  it('reports a network failure and releases the submit button', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const { user, submit } = await fillLogin()
    await user.click(submit)

    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce())
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/network error/i))
    expect(submit).toBeEnabled()
  })

  it('keeps intentional cancellation quiet', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    const { user, submit } = await fillLogin()
    await user.click(submit)

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await waitFor(() => expect(submit).toBeEnabled())
    expect(toast.error).not.toHaveBeenCalled()
  })
})
