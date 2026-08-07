import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveServerConsoleApiUrl } from '@/service/server'
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

    const data = await queryClient.fetchQuery(serverUserProfileQueryOptions())

    expect(serverUserProfileQueryOptions().queryKey).toEqual(userProfileQueryOptions().queryKey)
    expect(data).toEqual({
      profile: createProfile(),
      meta: {
        currentVersion: '1.2.3',
        currentEnv: 'DEVELOPMENT',
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5001/console/api/account/profile',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.any(Headers),
      }),
    )
  })

  it('should skip relative API prefixes unless a server API origin is configured', () => {
    expect(resolveServerConsoleApiUrl('/account/profile', undefined, '/console/api')).toBeNull()
    expect(
      resolveServerConsoleApiUrl(
        '/account/profile',
        'https://console.example.com/console/api',
        '/console/api',
      ),
    ).toBe('https://console.example.com/console/api/account/profile')
  })

  it('should preserve absolute API prefixes', () => {
    expect(
      resolveServerConsoleApiUrl(
        '/account/profile',
        undefined,
        'https://console.example.com/console/api',
      ),
    ).toBe('https://console.example.com/console/api/account/profile')
  })
})
