import { webcrypto } from 'node:crypto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useSyncExternalStore } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import {
  getAuthenticatedWebAppPassport,
  getWebAppAccessToken,
  getWebAppLoginMode,
} from '@/service/webapp-auth'
import { beginWebAppAccountLogin } from '@/service/webapp/login'
import { createDeferred } from '@/test/deferred'
import Layout from '../../layout'
import AccountLoginCallback from '../account-login-callback'

const serverRoute = vi.hoisted(() => ({ pathname: '', search: '' }))

vi.mock('@/next/navigation', async (original) => ({
  ...(await original<typeof import('@/next/navigation')>()),
  usePathname: () =>
    typeof window === 'undefined' ? serverRoute.pathname : window.location.pathname,
  useSearchParams: () => {
    useSyncExternalStore(
      (listener) => {
        window.addEventListener('popstate', listener)
        return () => window.removeEventListener('popstate', listener)
      },
      () => window.location.search,
      () => serverRoute.search,
    )
    return new URLSearchParams(
      typeof window === 'undefined' ? serverRoute.search : window.location.search,
    )
  },
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

describe('App user callback owner', () => {
  let queryClient: QueryClient
  let target: string
  let sequence = 0
  const setCallback = (returnTarget: string, code = 'one-use-code') => {
    const url = new URL(returnTarget, window.location.origin)
    url.searchParams.set('mode', 'end_user')
    url.searchParams.set('redirect_url', returnTarget)
    url.searchParams.set('login_code', code)
    window.history.replaceState({}, '', url)
    serverRoute.pathname = url.pathname
    serverRoute.search = url.search
  }

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
    setCallback(target)
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
        <Layout>
          <h1>Web App content</h1>
        </Layout>
      </QueryClientProvider>
    </StrictMode>
  )

  it('exchanges once in StrictMode and saves credentials before returning to the App', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ access_token: 'passport' }))
    const { unmount } = render(content())
    await waitFor(() => expect(replace).toHaveBeenCalledWith(target))
    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppLoginMode()).toBe('end_user')
    expect(
      getAuthenticatedWebAppPassport({ kind: 'default', code: `callback-app-${sequence}` }),
    ).toBe('passport')
    expect(fetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('heading', { name: 'Web App content' })).not.toBeInTheDocument()
    unmount()
    render(content())
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenCalledOnce()
    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppLoginMode()).toBe('end_user')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('hydrates the real layout before exchanging without starting App initialization', async () => {
    const response = createDeferred<Response>()
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(response.promise)
    let credentialsAtNavigation: unknown
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {
      credentialsAtNavigation = {
        bearer: getWebAppAccessToken(),
        mode: getWebAppLoginMode(),
        passport: getAuthenticatedWebAppPassport({
          kind: 'default',
          code: `callback-app-${sequence}`,
        }),
      }
    })
    const browserWindow = window
    let markup: string
    try {
      vi.stubGlobal('window', undefined)
      markup = renderToString(content())
    } finally {
      vi.stubGlobal('window', browserWindow)
    }
    expect(fetch).not.toHaveBeenCalled()
    const container = document.createElement('div')
    container.innerHTML = markup
    document.body.append(container)
    const onRecoverableError = vi.fn()
    let root: ReturnType<typeof hydrateRoot> | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, content(), { onRecoverableError })
      })
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
      const request = new Request(...fetch.mock.calls[0]!)
      expect(new URL(request.url).pathname).toMatch(/\/passport$/)
      expect(request.method).toBe('POST')
      expect(replace).not.toHaveBeenCalled()
      expect(screen.queryByRole('heading', { name: 'Web App content' })).not.toBeInTheDocument()
      await act(async () => response.resolve(Response.json({ access_token: 'passport' })))
      await waitFor(() => expect(replace).toHaveBeenCalledWith(target))
      expect(credentialsAtNavigation).toEqual({
        bearer: '',
        mode: 'end_user',
        passport: 'passport',
      })
      expect(fetch).toHaveBeenCalledOnce()
      expect(onRecoverableError).not.toHaveBeenCalled()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
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
      .mockResolvedValueOnce(Response.json({ access_token: 'next-passport' }))
    const { rerender } = render(content())
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    window.history.replaceState({}, '', '/chat/next-app?conversation=new#turn')
    const nextTarget = window.location.href
    await beginWebAppAccountLogin('/signin', nextTarget)
    setCallback(nextTarget, 'next-code')
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    rerender(content())

    await waitFor(() => expect(replace).toHaveBeenCalledWith(nextTarget))
    await act(async () => finishPrevious(Response.json({ access_token: 'previous-passport' })))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppLoginMode()).toBe('end_user')
    expect(getAuthenticatedWebAppPassport({ kind: 'default', code: 'next-app' })).toBe(
      'next-passport',
    )
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
      window.history.replaceState({}, '', `/chat/callback-app-${sequence}?${params}`)
      const fetch = vi.spyOn(globalThis, 'fetch')
      render(
        <QueryClientProvider client={queryClient}>
          <AccountLoginCallback />
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
