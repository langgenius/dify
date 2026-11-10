import type { WebAccountProfileResponse } from '@dify/contracts/api/web/types.gen'
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
import { createDeferred } from '@/test/deferred'
import { createReactI18nextMock } from '@/test/i18n-mock'
import { createWebAccountProfile } from '@/test/webapp-account-profile'
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

const profile: WebAccountProfileResponse = createWebAccountProfile({
  name: 'Joel',
  avatar: null,
  avatar_url: 'https://example.com/joel.png',
})
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
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/my-apps')
    captureAppAccessScope()
  })

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear()
    vi.restoreAllMocks()
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

  it('logs out using the account cookie and clears signed-in passports only after success', async () => {
    const user = userEvent.setup()
    const app = { kind: 'default', code: 'previous-app' } as const
    setWebAppAccessToken('account-session', 'end_user')
    setWebAppPassport(app, 'anonymous-history', 'anonymous')
    setWebAppPassport(app, 'signed-in-passport', 'authenticated')
    const pending = createDeferred<Response>()
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/logout')) {
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

    pending.resolve(Response.json({ result: 'success' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/my-apps'))
    expect(getWebAppAccessToken()).toBe('')
    expect(getAuthenticatedWebAppPassport(app)).toBe('')
    expect(getAnonymousWebAppPassport(app)).toBe('anonymous-history')
  })

  it('keeps the signed-in session when logout fails and allows retry from the menu', async () => {
    const user = userEvent.setup()
    const app = { kind: 'default', code: 'previous-app' } as const
    setWebAppAccessToken('account-session', 'end_user')
    setWebAppPassport(app, 'signed-in-passport', 'authenticated')
    let attempts = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/logout')) {
        attempts += 1
        return Promise.resolve(
          attempts === 1
            ? Response.json(
                { code: 'server_error', message: 'Logout unavailable', status: 503 },
                { status: 503 },
              )
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

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/my-apps'))
    expect(attempts).toBe(2)
    expect(getWebAppAccessToken()).toBe('')
  })
})
