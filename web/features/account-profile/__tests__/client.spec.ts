import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { dehydrate, hydrate, QueryClient, QueryObserver } from '@tanstack/react-query'
import { createHttpError } from '@/service/http-error'
import { userProfileQueryOptions } from '../client'

const request = vi.hoisted(() => vi.fn<typeof import('@/service/base').request>())
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  IS_DEV: false,
}))

const profile: GetAccountProfileResponse = {
  id: 'account-1',
  name: 'Account',
  email: 'account@example.com',
  avatar: '',
  avatar_url: null,
  is_password_set: true,
}

afterEach(() => request.mockReset())

it.each<{
  headers: HeadersInit
  currentVersion: string | null
  currentEnv: string | null
}>([
  {
    headers: { 'x-version': '1.2.3', 'x-env': 'PRODUCTION' },
    currentVersion: '1.2.3',
    currentEnv: 'PRODUCTION',
  },
  { headers: {}, currentVersion: null, currentEnv: null },
])(
  'preserves profile response metadata: $currentVersion, $currentEnv',
  async ({ headers, currentVersion, currentEnv }) => {
    request.mockResolvedValueOnce(Response.json(profile, { headers }))
    const client = new QueryClient()
    try {
      await expect(client.query(userProfileQueryOptions())).resolves.toEqual({
        profile,
        meta: { currentVersion, currentEnv },
      })
      expect(new URL(request.mock.calls[0]![0]).pathname).toBe('/console/api/account/profile')
      expect(request.mock.calls[0]?.[2]).toMatchObject({ silent: true })
      expect(request.mock.calls[0]?.[2]?.request?.method).toBe('GET')
    } finally {
      client.clear()
    }
  },
)

it('keeps response headers local to concurrent profile requests', async () => {
  let count = 0
  request.mockImplementation(async () => {
    const version = `${++count}`
    return Response.json({ ...profile, id: version }, { headers: { 'x-version': version } })
  })
  const first = new QueryClient()
  const second = new QueryClient()
  try {
    const responses = await Promise.all([
      first.query(userProfileQueryOptions()),
      second.query(userProfileQueryOptions()),
    ])
    for (const response of responses) expect(response.meta.currentVersion).toBe(response.profile.id)
    expect(responses[0]?.profile.id).not.toBe(responses[1]?.profile.id)
  } finally {
    first.clear()
    second.clear()
  }
})

it('refreshes an expiring signed avatar on mount even when the profile is still fresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  const options = userProfileQueryOptions()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(125_000)
  onTestFinished(() => clock.mockRestore())
  const file = '/files/avatar/file-preview?nonce=account-avatar-v2%3Aaccount-1'
  const cachedAvatar = `${file}&timestamp=100&sign=cached&expires_at=130`
  const refreshedAvatar = `${file}&timestamp=125&sign=refreshed&expires_at=155`
  request.mockResolvedValueOnce(Response.json({ ...profile, avatar_url: refreshedAvatar }))
  client.setQueryData(
    options.queryKey,
    {
      profile: { ...profile, avatar_url: cachedAvatar },
      meta: { currentVersion: null, currentEnv: null },
    },
    { updatedAt: 100_000 },
  )

  const observer = new QueryObserver(client, options)
  expect(observer.getCurrentResult().isStale).toBe(false)
  const unsubscribe = observer.subscribe(() => {})
  try {
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.profile.avatar_url).toBe(refreshedAvatar),
    )
    expect(request).toHaveBeenCalledOnce()
  } finally {
    unsubscribe()
    client.clear()
  }
})

it('refreshes a hydrated signed avatar on its first client mount', async () => {
  const options = userProfileQueryOptions()
  const serverClient = new QueryClient()
  const serverPrefetchedAt = 5_000_000
  // The browser is two minutes slow, and hydration happens four minutes after the prefetch.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(serverPrefetchedAt + 120_000)
  onTestFinished(() => clock.mockRestore())
  const cachedAvatar =
    '/files/avatar/file-preview?nonce=account-avatar-v2%3Aaccount-1&timestamp=4941&sign=cached&expires_at=5241'
  const refreshedAvatar =
    '/files/avatar/file-preview?nonce=account-avatar-v2%3Aaccount-1&timestamp=5240&sign=refreshed&expires_at=5540'
  serverClient.setQueryData(
    options.queryKey,
    {
      profile: { ...profile, avatar_url: cachedAvatar },
      meta: { currentVersion: null, currentEnv: null, serverPrefetched: true },
    },
    { updatedAt: serverPrefetchedAt },
  )

  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  hydrate(client, dehydrate(serverClient))
  request.mockResolvedValueOnce(Response.json({ ...profile, avatar_url: refreshedAvatar }))
  const observer = new QueryObserver(client, options)
  const unsubscribe = observer.subscribe(() => {})
  try {
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.profile.avatar_url).toBe(refreshedAvatar),
    )
    expect(observer.getCurrentResult().data?.meta.serverPrefetched).toBeUndefined()
    expect(request).toHaveBeenCalledOnce()
  } finally {
    unsubscribe()
    client.clear()
    serverClient.clear()
  }
})

it('anchors a slow browser response to its network receipt time', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  const options = userProfileQueryOptions()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
  onTestFinished(() => clock.mockRestore())
  const file = '/files/avatar/file-preview?nonce=account-avatar-v2%3Aaccount-1'
  const cachedAvatar = `${file}&timestamp=5061&sign=cached&expires_at=5361`
  const refreshedAvatar = `${file}&timestamp=5296&sign=refreshed&expires_at=5596`
  client.setQueryData(
    options.queryKey,
    {
      profile: { ...profile, avatar_url: cachedAvatar },
      meta: { currentVersion: null, currentEnv: null },
    },
    { updatedAt: 5_000_000 },
  )

  const freshObserver = new QueryObserver(client, options)
  const unsubscribeFresh = freshObserver.subscribe(() => {})
  expect(freshObserver.getCurrentResult().isFetching).toBe(false)
  expect(request).not.toHaveBeenCalled()
  unsubscribeFresh()

  clock.mockReturnValue(5_235_000)
  request.mockResolvedValueOnce(Response.json({ ...profile, avatar_url: refreshedAvatar }))
  const expiringObserver = new QueryObserver(client, options)
  const unsubscribeExpiring = expiringObserver.subscribe(() => {})
  try {
    await vi.waitFor(() =>
      expect(expiringObserver.getCurrentResult().data?.profile.avatar_url).toBe(refreshedAvatar),
    )
    expect(request).toHaveBeenCalledOnce()
  } finally {
    unsubscribeExpiring()
    client.clear()
  }
})

it('does not retry an unauthorized profile request', async () => {
  const error = createHttpError(new Response(null, { status: 401 }))
  request.mockRejectedValue(error)
  const client = new QueryClient()
  try {
    await expect(client.query(userProfileQueryOptions())).rejects.toBe(error)
    expect(request).toHaveBeenCalledOnce()
  } finally {
    client.clear()
  }
})
