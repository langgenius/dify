import type { WebAccountProfileResponse } from '@dify/contracts/api/web/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import { startWebAppAccountSession } from '@/service/webapp-auth'
import { createReactI18nextMock } from '@/test/i18n-mock'
import AccountMenu from '../account-menu'

vi.mock('react-i18next', () =>
  createReactI18nextMock({
    'app.endUser.account': 'Account',
    'app.endUser.userMenu': 'Account for {{name}}',
    'common.api.actionFailed': 'Action failed',
    'common.operation.retry': 'Retry',
  }),
)
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

const profile: WebAccountProfileResponse = {
  name: 'Joel',
  avatar: null,
  avatar_url: 'https://example.com/joel.png',
}
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
})
