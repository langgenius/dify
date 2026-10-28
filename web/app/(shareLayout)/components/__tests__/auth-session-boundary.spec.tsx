import { QueryClient, QueryClientProvider, queryOptions, useQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACCESS_TOKEN_LOCAL_STORAGE_NAME } from '@/config'
import { getWebAppAccessToken, setWebAppAccessToken } from '@/service/webapp-auth'
import AuthSessionBoundary from '../auth-session-boundary'

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/chat/app-code',
  useSearchParams: () => new URLSearchParams(),
}))

const profileKey = ['webapp', 'active-account'] as const
const connectionsKey = ['webapp', 'connections', 'configuration', 'app-code'] as const
const publicPermissionKey = [
  'access-control',
  'user-can-access-app',
  'app-id',
  true,
  false,
] as const
const installedPermissionKey = [
  'access-control',
  'user-can-access-app',
  'installed-app-id',
  true,
  true,
] as const
const otherAccessKey = ['access-control', 'whitelist', 'app-id'] as const
const consoleKey = ['console', 'account', 'profile'] as const

function AppContent() {
  const { data } = useQuery(
    queryOptions({
      queryKey: profileKey,
      queryFn: async ({ signal }) => {
        const response = await fetch('/auth-session-profile', {
          signal,
          headers: { Authorization: `Bearer ${getWebAppAccessToken()}` },
        })
        return response.text()
      },
      staleTime: Infinity,
    }),
  )
  return (
    <>
      <p>{data ?? 'Loading account'}</p>
      <label>
        Conversation draft
        <input defaultValue="" />
      </label>
    </>
  )
}

describe('Web App account session boundary', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setWebAppAccessToken('A', 'end_user')
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  const renderApp = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionBoundary>
          <AppContent />
        </AuthSessionBoundary>
      </QueryClientProvider>,
    )

  it('replaces the old account draft and public App data before mounting the next account', async () => {
    const user = userEvent.setup()
    let resolveNextAccount!: (response: Response) => void
    const nextAccount = new Promise<Response>((resolve) => {
      resolveNextAccount = resolve
    })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Account A'))
      .mockReturnValueOnce(nextAccount)
    localStorage.setItem('session_id-app-code', 'anonymous-history-session')
    renderApp()
    await screen.findByText('Account A')
    await user.type(screen.getByRole('textbox', { name: 'Conversation draft' }), 'Private draft')
    queryClient.setQueryData(connectionsKey, { connection: 'Account A connection' })
    queryClient.setQueryData(publicPermissionKey, { result: true })
    queryClient.setQueryData(installedPermissionKey, { result: true })
    queryClient.setQueryData(otherAccessKey, ['Console whitelist'])
    queryClient.setQueryData(consoleKey, { name: 'Studio account' })

    act(() => setWebAppAccessToken('B', 'end_user'))

    expect(screen.queryByText('Account A')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Conversation draft' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Conversation draft' })).toHaveValue('')
    })
    expect(queryClient.getQueryData(connectionsKey)).toBeUndefined()
    expect(queryClient.getQueryData(publicPermissionKey)).toBeUndefined()
    expect(queryClient.getQueryData(profileKey)).toBeUndefined()
    expect(queryClient.getQueryData(installedPermissionKey)).toEqual({ result: true })
    expect(queryClient.getQueryData(otherAccessKey)).toEqual(['Console whitelist'])
    expect(queryClient.getQueryData(consoleKey)).toEqual({ name: 'Studio account' })
    expect(localStorage.getItem('session_id-app-code')).toBe('anonymous-history-session')
    expect(fetch).toHaveBeenLastCalledWith(
      '/auth-session-profile',
      expect.objectContaining({ headers: { Authorization: 'Bearer B' } }),
    )

    await act(async () => resolveNextAccount(new Response('Account B')))
    expect(await screen.findByText('Account B')).toBeInTheDocument()
  })

  it('resets the current App when another tab changes the account proof', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Account A'))
      .mockResolvedValueOnce(new Response('Account B'))
    renderApp()
    await screen.findByText('Account A')
    await user.type(screen.getByRole('textbox', { name: 'Conversation draft' }), 'Private draft')

    act(() => {
      localStorage.setItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME, 'B')
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: ACCESS_TOKEN_LOCAL_STORAGE_NAME,
          oldValue: 'A',
          newValue: 'B',
          storageArea: localStorage,
        }),
      )
    })

    expect(await screen.findByText('Account B')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Conversation draft' })).toHaveValue('')
    expect(screen.queryByText('Account A')).not.toBeInTheDocument()
  })
})
