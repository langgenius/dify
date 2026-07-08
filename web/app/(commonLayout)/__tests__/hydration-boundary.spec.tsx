import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryClient: undefined as QueryClient | undefined,
  profileQueryFn: vi.fn(),
  systemFeaturesQueryFn: vi.fn(),
  workspaceQueryFn: vi.fn(),
  workspaceQueryOptions: vi.fn(),
  getServerConsoleClientContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  headers: vi.fn(),
  resolveServerConsoleApiUrl: vi.fn(),
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => mocks.queryClient,
}))

vi.mock('@/context/external-service-sync', () => ({
  ExternalServiceSync: () => null,
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

vi.mock('@/service/server', () => ({
  getServerConsoleClientContext: () => mocks.getServerConsoleClientContext(),
  resolveServerConsoleApiUrl: (...args: unknown[]) => mocks.resolveServerConsoleApiUrl(...args),
  serverConsoleQuery: {
    workspaces: {
      current: {
        post: {
          queryOptions: (...args: unknown[]) => mocks.workspaceQueryOptions(...args),
        },
      },
    },
  },
}))

vi.mock('@/features/system-features/server', () => ({
  serverSystemFeaturesQueryOptions: () => ({
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
    mocks.resolveServerConsoleApiUrl.mockReturnValue('https://console.example.com/console/api/account/profile')
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
    mocks.workspaceQueryFn.mockResolvedValue({ id: 'workspace-id', name: 'Workspace' })
    mocks.getServerConsoleClientContext.mockResolvedValue({
      cookie: 'session=abc',
      csrfToken: 'csrf-token',
    })
    mocks.workspaceQueryOptions.mockReturnValue({
      queryKey: ['console', 'workspaces', 'current', 'post'],
      queryFn: mocks.workspaceQueryFn,
      retry: false,
    })
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
    expect(mocks.getServerConsoleClientContext).toHaveBeenCalledTimes(1)
    expect(mocks.workspaceQueryOptions).toHaveBeenCalledWith({
      context: {
        cookie: 'session=abc',
        csrfToken: 'csrf-token',
      },
      retry: false,
    })
    expect(mocks.workspaceQueryFn).toHaveBeenCalledTimes(1)
  })

  it('should redirect unauthorized users to the refresh route with the current path', async () => {
    mocks.profileQueryFn.mockRejectedValue(new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }))
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/auth/refresh?redirect_url=%2Fapps%3Ftag%3Dworkflow')
  })

  it('should default unauthorized refresh redirects to the home path when the pathname header is missing', async () => {
    mocks.headers.mockResolvedValue(new Headers())
    mocks.profileQueryFn.mockRejectedValue(new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }))
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/auth/refresh?redirect_url=%2F')
  })

  it('should redirect setup errors to install', async () => {
    mocks.profileQueryFn.mockRejectedValue(new Response(JSON.stringify({ code: 'not_setup' }), { status: 401 }))
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/install')
  })

  it('should render children without server prefetch when the server API URL is not resolvable', async () => {
    mocks.resolveServerConsoleApiUrl.mockReturnValue(null)
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
    expect(mocks.profileQueryFn).not.toHaveBeenCalled()
    expect(mocks.systemFeaturesQueryFn).not.toHaveBeenCalled()
    expect(mocks.workspaceQueryFn).not.toHaveBeenCalled()
  })
})
