import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryClient: undefined as QueryClient | undefined,
  profileQueryFn: vi.fn(),
  systemFeaturesQueryFn: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  headers: vi.fn(),
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => mocks.queryClient,
}))

vi.mock('@/next/headers', () => ({
  headers: () => mocks.headers(),
}))

vi.mock('@/next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
}))

vi.mock('@/features/account-profile/server', () => ({
  serverUserProfileQueryOptions: () => ({
    queryKey: ['common', 'user-profile'],
    queryFn: mocks.profileQueryFn,
    retry: false,
  }),
}))

vi.mock('@/service/system-features', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['console', 'system-features'],
    queryFn: mocks.systemFeaturesQueryFn,
    retry: false,
  }),
}))

describe('CommonLayoutHydrationBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.headers.mockResolvedValue(new Headers({
      'x-dify-pathname': '/apps',
      'x-dify-search': '?tag=workflow',
    }))
    mocks.profileQueryFn.mockResolvedValue({
      profile: {
        id: 'account-id',
        name: 'Dify User',
        email: 'user@example.com',
        avatar: '',
        avatar_url: null,
        is_password_set: true,
      },
      meta: {
        currentVersion: '1.0.0',
        currentEnv: 'DEVELOPMENT',
      },
    })
    mocks.systemFeaturesQueryFn.mockResolvedValue({ branding: { enabled: false } })
  })

  it('should hydrate common layout queries and render children', async () => {
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    const element = await CommonLayoutHydrationBoundary({
      children: <div>Common shell</div>,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        {element as ReactElement}
      </QueryClientProvider>,
    )
    expect(screen.getByText('Common shell')).toBeInTheDocument()
    expect(mocks.profileQueryFn).toHaveBeenCalledTimes(1)
    expect(mocks.systemFeaturesQueryFn).toHaveBeenCalledTimes(1)
  })

  it('should redirect unauthorized users to signin with the current path', async () => {
    mocks.profileQueryFn.mockRejectedValue(new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }))
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/signin?redirect_url=%2Fapps%3Ftag%3Dworkflow')
  })

  it('should redirect setup errors to install', async () => {
    mocks.profileQueryFn.mockRejectedValue(new Response(JSON.stringify({ code: 'not_setup' }), { status: 401 }))
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/install')
  })
})
