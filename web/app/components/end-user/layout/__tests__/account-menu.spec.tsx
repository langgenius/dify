import type {
  WebAccountProfileResponse,
  WebSystemFeatureResponse,
} from '@dify/contracts/api/web/types.gen'
import { webcrypto } from 'node:crypto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import {
  getAnonymousWebAppPassport,
  getAuthenticatedWebAppPassport,
  getWebAppAccessToken,
  setWebAppAccessToken,
  setWebAppPassport,
  startWebAppAccountSession,
} from '@/service/webapp-auth'
import { redirectToWebAppPortalSignIn } from '@/service/webapp/portal-login'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDeferred } from '@/test/deferred'
import { createReactI18nextMock } from '@/test/i18n-mock'
import AccountMenu from '../account-menu'

vi.mock('react-i18next', () =>
  createReactI18nextMock({
    'app.endUser.account': 'Account',
    'app.endUser.userMenu': 'Account for {{name}}',
    'common.api.actionFailed': 'Action failed',
    'common.operation.retry': 'Retry',
    'common.userProfile.logout': 'Log out',
  }),
)
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

const profile: WebAccountProfileResponse = {
  email: 'joel@example.com',
  is_password_set: false,
  interface_language: 'en-US',
  interface_theme: 'system',
  timezone: 'UTC',
  name: 'Joel',
  avatar: null,
  avatar_url: 'https://example.com/joel.png',
}
const systemFeatures = {
  ...createSystemFeaturesFixture(),
  console_web_url: 'https://accounts.example/console',
} satisfies WebSystemFeatureResponse
const clients: QueryClient[] = []

function renderAccountMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <AccountMenu />
    </QueryClientProvider>,
  )
}

describe('end-user account menu', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto)
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/my-apps')
    captureAppAccessScope()
  })

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })

  it('shows the account name and avatar supplied by the profile API', async () => {
    function loadedAvatar() {
      const image = document.createElement('img')
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 32 },
      })
      return image
    }
    vi.spyOn(window, 'Image').mockImplementation(loadedAvatar)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(profile))
    renderAccountMenu()

    const trigger = await screen.findByRole('button', { name: 'Account for Joel' })

    expect(within(trigger).getByText('Joel')).toBeInTheDocument()
    expect(trigger.querySelector('img')).toHaveAttribute('src', profile.avatar_url)
    expect(screen.queryByText('Evan Z')).not.toBeInTheDocument()
  })

  it('shows the real name initial when the profile has no avatar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ ...profile, avatar_url: null }),
    )
    renderAccountMenu()

    const trigger = await screen.findByRole('button', { name: 'Account for Joel' })

    expect(within(trigger).getByText('J')).toBeInTheDocument()
    expect(trigger.querySelector('img')).not.toBeInTheDocument()
  })

  it('shows only a generic Account label while the profile is pending', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise<Response>(() => {}))
    renderAccountMenu()

    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.queryByText('Joel')).not.toBeInTheDocument()
    expect(screen.queryByText('Evan Z')).not.toBeInTheDocument()
  })

  it('keeps a failed profile generic and retries from the menu without inventing a user', async () => {
    const user = userEvent.setup()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(
          { code: 'server_error', message: 'Profile unavailable', status: 503 },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json(profile))
    renderAccountMenu()

    await user.click(screen.getByRole('button', { name: /^Account/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Profile unavailable')
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.queryByText('Evan Z')).not.toBeInTheDocument()
    expect(screen.queryByText('Joel')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: 'Account for Joel' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('removes the previous name while loading a different account profile', async () => {
    let resolve!: (response: Response) => void
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(profile))
      .mockReturnValueOnce(
        new Promise<Response>((done) => {
          resolve = done
        }),
      )
    renderAccountMenu()
    await screen.findByRole('button', { name: 'Account for Joel' })

    act(() => startWebAppAccountSession())
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Joel')).not.toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
    resolve(Response.json({ ...profile, name: 'Ada', avatar_url: null }))

    expect(await screen.findByRole('button', { name: 'Account for Ada' })).toBeInTheDocument()
    expect(screen.queryByText('Joel')).not.toBeInTheDocument()
  })

  it('clears the Web App session and sends the browser to Console sign-out before signing in again', async () => {
    const user = userEvent.setup()
    const app = { kind: 'default', code: 'previous-app' } as const
    setWebAppAccessToken('account-session', 'end_user')
    setWebAppPassport(app, 'anonymous-history', 'anonymous')
    setWebAppPassport(app, 'signed-in-passport', 'authenticated')
    const pending = createDeferred<Response>()
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/system-features'))
        return Promise.resolve(Response.json(systemFeatures))
      if (pathname.endsWith('/logout')) {
        requests.push(request)
        return pending.promise
      }
      return Promise.resolve(Response.json(profile))
    })
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    renderAccountMenu()

    await user.click(await screen.findByRole('button', { name: 'Account for Joel' }))
    const logout = screen.getByRole('menuitem', { name: 'Log out' })
    await user.click(logout)

    await waitFor(() => expect(requests).toHaveLength(1))
    const request = requests.at(0)
    expect(request?.method).toBe('POST')
    expect(request?.credentials).toBe('include')
    expect(request?.headers.has('authorization')).toBe(false)
    expect(request?.headers.has('x-app-code')).toBe(false)
    expect(request?.headers.has('x-app-passport')).toBe(false)
    expect(logout).toHaveAttribute('aria-disabled', 'true')
    await user.click(logout)
    expect(requests).toHaveLength(1)
    expect(getWebAppAccessToken()).toBe('account-session')
    expect(getAuthenticatedWebAppPassport(app)).toBe('signed-in-passport')
    expect(replace).not.toHaveBeenCalled()

    const recovery = redirectToWebAppPortalSignIn('/my-apps?view=starred')
    pending.resolve(Response.json({ result: 'success' }))
    await recovery

    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    const signin = new URL(replace.mock.calls[0]![0])
    expect(`${signin.origin}${signin.pathname}`).toBe('https://accounts.example/console/signin')
    expect(Object.fromEntries(signin.searchParams)).toEqual({
      is_end_user: '1',
      redirect_url: '/my-apps',
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: 'S256',
      switch_account: '1',
    })
    expect(getWebAppAccessToken()).toBe('')
    expect(getAuthenticatedWebAppPassport(app)).toBe('')
    expect(getAnonymousWebAppPassport(app)).toBe('anonymous-history')
  })

  it.each([401, 503])('allows retry after logout fails with %s', async (status) => {
    const user = userEvent.setup()
    const app = { kind: 'default', code: 'previous-app' } as const
    setWebAppAccessToken('account-session', 'end_user')
    setWebAppPassport(app, 'signed-in-passport', 'authenticated')
    let attempts = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/system-features'))
        return Promise.resolve(Response.json(systemFeatures))
      if (new URL(request.url).pathname.endsWith('/logout')) {
        attempts += 1
        return Promise.resolve(
          attempts === 1
            ? Response.json({ message: 'Logout unavailable', status }, { status })
            : Response.json({ result: 'success' }),
        )
      }
      return Promise.resolve(Response.json(profile))
    })
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    renderAccountMenu()

    await user.click(await screen.findByRole('button', { name: 'Account for Joel' }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Logout unavailable')
    expect(getWebAppAccessToken()).toBe('account-session')
    expect(getAuthenticatedWebAppPassport(app)).toBe('signed-in-passport')
    expect(replace).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))

    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(new URL(replace.mock.calls[0]![0]).searchParams.get('switch_account')).toBe('1')
    expect(attempts).toBe(2)
    expect(getWebAppAccessToken()).toBe('')
  })
})
