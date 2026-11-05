import type { WebAccountProfileResponse } from '@dify/contracts/api/web/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { startWebAppAccountSession } from '@/service/webapp-auth'
import Sidebar from '../sidebar'

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/my-apps',
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const buildAppLabel = 'app.endUser.buildYourOwnApp'
const profile: WebAccountProfileResponse = {
  name: 'Joel',
  avatar: null,
  avatar_url: null,
  has_owned_tenant: false,
  has_tenant: false,
}
const clients: QueryClient[] = []

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(queryClient)
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState({}, '', '/my-apps')
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

describe('sidebar workspace entry', () => {
  it.each([
    { hasTenant: false, destination: '/create-workspace' },
    { hasTenant: true, destination: '/' },
  ])('routes to $destination based on workspace membership', async ({ hasTenant, destination }) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ ...profile, has_tenant: hasTenant }))
    renderSidebar()

    expect(await screen.findByRole('link', { name: buildAppLabel })).toHaveAttribute(
      'href',
      destination,
    )
    expect(screen.getByRole('link', { name: 'app.endUser.myApps' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByText(profile.name)).toBeVisible()
    expect(fetch).toHaveBeenCalledOnce()
    const [input, init] = fetch.mock.calls[0]!
    const request = new Request(input, init)
    expect(new URL(request.url).pathname).toMatch(/\/account\/profile$/)
    expect(request.credentials).toBe('include')
    expect(request.headers.has('x-app-code')).toBe(false)
    expect(request.headers.has('x-app-passport')).toBe(false)
  })

  it('waits for profile data before rendering the workspace entry', async () => {
    let finishProfile!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        finishProfile = resolve
      }),
    )
    renderSidebar()

    expect(screen.queryByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: buildAppLabel })).not.toBeInTheDocument()
    await act(async () => {
      finishProfile(Response.json({ ...profile, has_tenant: true }))
    })
    expect(await screen.findByRole('link', { name: buildAppLabel })).toHaveAttribute('href', '/')
  })

  it.each([null, undefined])(
    'treats unavailable membership (%s) as no workspace',
    async (hasTenant) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ ...profile, has_tenant: hasTenant }),
      )
      renderSidebar()

      expect(await screen.findByRole('link', { name: buildAppLabel })).toHaveAttribute(
        'href',
        '/create-workspace',
      )
    },
  )

  it('treats a failed lookup as no workspace', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ code: 'unavailable', message: 'Profile unavailable.' }, { status: 503 }),
    )
    renderSidebar()

    expect(await screen.findByRole('link', { name: buildAppLabel })).toHaveAttribute(
      'href',
      '/create-workspace',
    )
  })

  it('clears the previous account destination while loading the new account profile', async () => {
    let finishNextAccount!: (response: Response) => void
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ ...profile, has_tenant: true }))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finishNextAccount = resolve
        }),
      )
    renderSidebar()
    expect(await screen.findByRole('link', { name: buildAppLabel })).toHaveAttribute('href', '/')

    await act(async () => {
      startWebAppAccountSession()
    })
    expect(screen.queryByRole('link', { name: buildAppLabel })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: buildAppLabel })).not.toBeInTheDocument()
    await act(async () => {
      finishNextAccount(Response.json({ ...profile, name: 'Alice' }))
    })
    expect(await screen.findByRole('link', { name: buildAppLabel })).toHaveAttribute(
      'href',
      '/create-workspace',
    )
    expect(screen.getByText('Alice')).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
