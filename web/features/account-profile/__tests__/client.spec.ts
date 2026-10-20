import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClient } from '@tanstack/react-query'
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
