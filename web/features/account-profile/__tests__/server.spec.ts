// @vitest-environment node

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { userProfileQueryOptions } from '../client'

const headersMock = vi.fn()
const cookiesMock = vi.fn()

vi.mock('server-only', () => ({}))

vi.mock('@/config/server', () => ({
  SERVER_CONSOLE_API_PREFIX: undefined,
}))

vi.mock('@/next/headers', () => ({
  headers: () => headersMock(),
  cookies: () => cookiesMock(),
}))

const createProfile = (
  overrides: Partial<GetAccountProfileResponse> = {},
): GetAccountProfileResponse => ({
  id: 'account-id',
  name: 'Dify User',
  email: 'user@example.com',
  avatar: '',
  avatar_url: null,
  is_password_set: true,
  ...overrides,
})

afterEach(() => vi.unstubAllGlobals())

describe('serverUserProfileQueryOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers({ cookie: 'session=abc' }))
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => ({ value: 'csrf-token' })),
    })
  })

  it('should reuse the client profile query key and return the same data shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createProfile()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-version': '1.2.3',
          'x-env': 'DEVELOPMENT',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { serverUserProfileQueryOptions } = await import('../server')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const data = await queryClient.query(serverUserProfileQueryOptions())

    expect(serverUserProfileQueryOptions().queryKey).toEqual(userProfileQueryOptions().queryKey)
    expect(data).toEqual({
      profile: createProfile(),
      meta: {
        currentVersion: '1.2.3',
        currentEnv: 'DEVELOPMENT',
      },
    })
    const [request, init] = fetchMock.mock.calls[0]!
    expect(request.url).toBe('http://localhost:5001/console/api/account/profile')
    expect(request.method).toBe('GET')
    expect(request.headers.get('cookie')).toBe('session=abc')
    expect(init).toMatchObject({ cache: 'no-store' })
  })
})
