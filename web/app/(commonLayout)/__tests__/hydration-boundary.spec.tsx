import type { DehydratedState } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  queryClient: undefined as QueryClient | undefined,
  profileQueryFn: vi.fn(),
  workspaceQueryFn: vi.fn(),
  workspaceQueryOptions: vi.fn(),
  permissionQueryFn: vi.fn(),
  permissionQueryOptions: vi.fn(),
  featuresQueryFn: vi.fn(),
  featuresQueryOptions: vi.fn(),
  getServerConsoleClientContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  headers: vi.fn(),
  resolveServerConsoleApiUrl: vi.fn(),
  basePath: '',
}))

vi.mock('@/app/get-query-client', () => {
  return {
    getQueryClient: () => mocks.queryClient,
  }
})

vi.mock('@/next/headers', () => ({
  headers: () => mocks.headers(),
}))

vi.mock('@/next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
}))

vi.mock('@/utils/var', () => ({
  get basePath() {
    return mocks.basePath
  },
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
    features: {
      get: {
        queryOptions: (...args: unknown[]) => mocks.featuresQueryOptions(...args),
      },
    },
    workspaces: {
      current: {
        summary: {
          get: {
            queryOptions: (...args: unknown[]) => mocks.workspaceQueryOptions(...args),
          },
        },
        rbac: {
          myPermissions: {
            get: {
              queryOptions: (...args: unknown[]) => mocks.permissionQueryOptions(...args),
            },
          },
        },
      },
    },
  },
}))

describe('CommonLayoutHydrationBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.basePath = ''
    mocks.queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.headers.mockResolvedValue(
      new Headers({
        'x-dify-pathname': '/apps',
        'x-dify-search': '?tag=workflow',
      }),
    )
    mocks.resolveServerConsoleApiUrl.mockReturnValue(
      'https://console.example.com/console/api/account/profile',
    )
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
    mocks.workspaceQueryFn.mockResolvedValue({
      id: 'workspace-id',
      name: 'Workspace',
      role: 'owner',
      plan: 'sandbox',
      credits: 200,
    })
    mocks.permissionQueryFn.mockResolvedValue({
      workspace: { permission_keys: ['agent.manage'] },
      app: { default_permission_keys: [], overrides: [] },
      dataset: { default_permission_keys: [], overrides: [] },
    })
    mocks.getServerConsoleClientContext.mockResolvedValue({
      cookie: 'session=abc',
      csrfToken: 'csrf-token',
    })
    mocks.workspaceQueryOptions.mockReturnValue({
      queryKey: ['console', 'workspaces', 'current', 'summary', 'get'],
      queryFn: mocks.workspaceQueryFn,
      retry: false,
    })
    mocks.permissionQueryOptions.mockReturnValue({
      queryKey: [
        ['console', 'workspaces', 'current', 'rbac', 'myPermissions', 'get'],
        { type: 'query' },
      ],
      queryFn: mocks.permissionQueryFn,
      retry: false,
    })
    mocks.featuresQueryFn.mockResolvedValue({ enable_skill: true })
    mocks.featuresQueryOptions.mockReturnValue({
      queryKey: ['console', 'features', 'get'],
      queryFn: mocks.featuresQueryFn,
      retry: false,
    })
  })

  it('should prefetch common layout queries', async () => {
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
    expect(mocks.getServerConsoleClientContext).toHaveBeenCalledTimes(1)
    expect(mocks.workspaceQueryOptions).toHaveBeenCalledWith({
      context: {
        cookie: 'session=abc',
        csrfToken: 'csrf-token',
      },
      retry: false,
    })
    expect(mocks.workspaceQueryFn).toHaveBeenCalledTimes(1)
    expect(mocks.permissionQueryOptions).toHaveBeenCalledWith({
      context: {
        cookie: 'session=abc',
        csrfToken: 'csrf-token',
      },
      retry: false,
    })
    expect(mocks.permissionQueryFn).toHaveBeenCalledTimes(1)
    expect(mocks.featuresQueryOptions).toHaveBeenCalledWith({
      context: {
        cookie: 'session=abc',
        csrfToken: 'csrf-token',
      },
      retry: false,
    })
    expect(mocks.featuresQueryFn).toHaveBeenCalledTimes(1)
  })

  it('should dehydrate only Common-owned queries', async () => {
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    const element = await CommonLayoutHydrationBoundary({ children: null })
    const state = (element as ReactElement<{ state: DehydratedState }>).props.state
    const queryKeys = state.queries.map((query) => query.queryKey)

    expect(queryKeys).toHaveLength(4)
    expect(queryKeys).toEqual(
      expect.arrayContaining([
        ['common', 'user-profile'],
        ['console', 'workspaces', 'current', 'summary', 'get'],
        [['console', 'workspaces', 'current', 'rbac', 'myPermissions', 'get'], { type: 'query' }],
        ['console', 'features', 'get'],
      ]),
    )
  })

  it.each([
    {
      queryKey: ['console', 'workspaces', 'current', 'summary', 'get'],
      target: 'workspace' as const,
    },
    {
      queryKey: [
        ['console', 'workspaces', 'current', 'rbac', 'myPermissions', 'get'],
        { type: 'query' },
      ],
      target: 'permissions' as const,
    },
    {
      queryKey: ['console', 'features', 'get'],
      target: 'features' as const,
    },
  ])(
    'should keep the Common shell recoverable when the $target query fails',
    async ({ queryKey, target }) => {
      const failedQueryFn = {
        features: mocks.featuresQueryFn,
        permissions: mocks.permissionQueryFn,
        workspace: mocks.workspaceQueryFn,
      }[target]
      failedQueryFn.mockRejectedValue(new Error(`${target} unavailable`))
      const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

      const element = await CommonLayoutHydrationBoundary({ children: <div>Common shell</div> })
      const state = (element as ReactElement<{ state: DehydratedState }>).props.state

      expect(mocks.redirect).not.toHaveBeenCalled()
      expect(state.queries.map((query) => query.queryKey)).not.toContainEqual(queryKey)
    },
  )

  it('should redirect unauthorized users to the refresh route with the current path', async () => {
    mocks.basePath = '/workflow'
    mocks.profileQueryFn.mockRejectedValue(
      new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }),
    )
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/auth/refresh?redirect_url=%2Fapps%3Ftag%3Dworkflow',
    )
  })

  it('should use the internal home path when the pathname header is missing', async () => {
    mocks.basePath = '/workflow'
    mocks.headers.mockResolvedValue(new Headers())
    mocks.profileQueryFn.mockRejectedValue(
      new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }),
    )
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith('/auth/refresh?redirect_url=%2F')
  })

  it.each([
    ['not_setup', '/install'],
    ['not_init_validated', '/init'],
  ])('should use an internal destination for %s errors', async (code, destination) => {
    mocks.basePath = '/workflow'
    mocks.profileQueryFn.mockRejectedValue(new Response(JSON.stringify({ code }), { status: 401 }))
    const { CommonLayoutHydrationBoundary } = await import('../hydration-boundary')

    await expect(CommonLayoutHydrationBoundary({ children: null })).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.redirect).toHaveBeenCalledWith(destination)
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
    expect(mocks.workspaceQueryFn).not.toHaveBeenCalled()
    expect(mocks.permissionQueryFn).not.toHaveBeenCalled()
    expect(mocks.featuresQueryFn).not.toHaveBeenCalled()
  })
})
