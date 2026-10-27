import { webcrypto } from 'node:crypto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useSyncExternalStore } from 'react'
import { getWebAppAccessToken } from '@/service/webapp-auth'
import { beginWebAppAccountLogin } from '@/service/webapp/login'
import AuthSessionBoundary from '../../components/auth-session-boundary'
import Splash from '../../components/splash'
import EndUserLogin from '../end-user-login'
import WebAppSignIn from '../page'

vi.mock('@/next/navigation', async (original) => ({
  ...(await original<typeof import('@/next/navigation')>()),
  usePathname: () => window.location.pathname,
  useSearchParams: () => {
    useSyncExternalStore(
      (listener) => {
        window.addEventListener('popstate', listener)
        return () => window.removeEventListener('popstate', listener)
      },
      () => window.location.search,
    )
    return new URLSearchParams(window.location.search)
  },
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

describe('App user callback owner', () => {
  let queryClient: QueryClient
  let target: string
  let sequence = 0
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('crypto', webcrypto)
    window.history.replaceState(
      {},
      '',
      `/chat/callback-app-${++sequence}?conversation=existing#turn`,
    )
    target = window.location.href
    await beginWebAppAccountLogin('/signin', target)
    window.history.replaceState(
      {},
      '',
      `/webapp-signin?${new URLSearchParams({ mode: 'end_user', redirect_url: target, login_code: 'one-use-code' })}`,
    )
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })
  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
    localStorage.clear()
    sessionStorage.clear()
  })

  const content = () => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthSessionBoundary>
          <Splash>
            <WebAppSignIn />
          </Splash>
        </AuthSessionBoundary>
      </QueryClientProvider>
    </StrictMode>
  )

  it('exchanges once despite StrictMode and the proof changing, bypassing the enterprise bootstrap', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ access_token: 'passport', webapp_access_token: 'proof' }))
    const { unmount } = render(content())
    await waitFor(() => expect(replace).toHaveBeenCalledWith(target))
    expect(getWebAppAccessToken()).toBe('proof')
    expect(fetch).toHaveBeenCalledOnce()
    unmount()
    render(content())
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows failure and lets the user return to the App with the failed transaction cleared', async () => {
    const user = userEvent.setup()
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { code: 'invalid_param', message: 'Expired login code', status: 400 },
        { status: 400 },
      ),
    )
    render(content())
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(getWebAppAccessToken()).toBe('')
    await user.click(screen.getByRole('button', { name: 'share.login.backToHome' }))
    expect(replace).toHaveBeenCalledWith(target)
    expect(sessionStorage.getItem(`webapp-account-login-callback-app-${sequence}`)).toBeNull()
  })

  it('starts the new callback when its URL changes and ignores the previous pending exchange', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    let finishPrevious!: (response: Response) => void
    const previous = new Promise<Response>((resolve) => {
      finishPrevious = resolve
    })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(previous)
      .mockResolvedValueOnce(
        Response.json({ access_token: 'next-passport', webapp_access_token: 'next-proof' }),
      )
    const { rerender } = render(content())
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    window.history.replaceState({}, '', '/chat/next-app?conversation=new#turn')
    const nextTarget = window.location.href
    await beginWebAppAccountLogin('/signin', nextTarget)
    window.history.replaceState(
      {},
      '',
      `/webapp-signin?${new URLSearchParams({ mode: 'end_user', redirect_url: nextTarget, login_code: 'next-code' })}`,
    )
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    rerender(content())

    await waitFor(() => expect(replace).toHaveBeenCalledWith(nextTarget))
    await act(async () =>
      finishPrevious(
        Response.json({ access_token: 'previous-passport', webapp_access_token: 'previous-proof' }),
      ),
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(getWebAppAccessToken()).toBe('next-proof')
    expect(replace).not.toHaveBeenCalledWith(target)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([null, 'https://untrusted.example/chat/another-app'])(
    'returns to the trusted home when the callback return is %s',
    async (redirect) => {
      const user = userEvent.setup()
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      const params = new URLSearchParams({ mode: 'end_user', login_code: 'invalid-callback' })
      if (redirect) params.set('redirect_url', redirect)
      window.history.replaceState({}, '', `/webapp-signin?${params}`)
      const fetch = vi.spyOn(globalThis, 'fetch')
      render(
        <QueryClientProvider client={queryClient}>
          <EndUserLogin />
        </QueryClientProvider>,
      )

      expect(await screen.findByRole('alert')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'share.login.backToHome' }))

      expect(replace).toHaveBeenCalledWith('/')
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['getItem', 'removeItem'] as const)(
    'still returns to the App when transaction storage %s is unavailable',
    async (method) => {
      const user = userEvent.setup()
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      vi.spyOn(sessionStorage, method).mockImplementation(() => {
        throw new DOMException('Storage is unavailable.', 'SecurityError')
      })
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        Response.json(
          { code: 'invalid_param', message: 'Expired login code', status: 400 },
          { status: 400 },
        ),
      )
      render(content())

      expect(await screen.findByRole('alert')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'share.login.backToHome' }))

      expect(replace).toHaveBeenCalledWith(target)
    },
  )
})
