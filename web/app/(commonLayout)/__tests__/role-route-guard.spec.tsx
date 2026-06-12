import { useQuery } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RoleRouteGuard from '../role-route-guard'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  replace: vi.fn(),
  currentWorkspaceQueryOptions: vi.fn(() => ({ queryKey: ['console', 'workspaces', 'current', 'post'] })),
}))

let mockPathname = '/apps'
let mockIsLoadingWorkspacePermissionKeys = false
let mockWorkspacePermissionKeys: string[] = ['app_library.access', 'tool.manage']

vi.mock('@/next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace: mocks.replace,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isLoadingWorkspacePermissionKeys: mockIsLoadingWorkspacePermissionKeys,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: vi.fn(),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        post: {
          queryOptions: mocks.currentWorkspaceQueryOptions,
        },
      },
    },
  },
}))

const mockUseQuery = vi.mocked(useQuery)

const setCurrentWorkspaceQuery = (overrides: { role?: string, isPending?: boolean } = {}) => {
  mockUseQuery.mockReturnValue({
    data: overrides.role,
    isPending: overrides.isPending ?? false,
  } as ReturnType<typeof useQuery>)
}

describe('RoleRouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/apps'
    mockIsLoadingWorkspacePermissionKeys = false
    mockWorkspacePermissionKeys = ['app_library.access', 'tool.manage']
    setCurrentWorkspaceQuery()
  })

  it('should render loading while workspace is loading', () => {
    mockPathname = '/explore'
    mockIsLoadingWorkspacePermissionKeys = true

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('should redirect users without route permission on guarded routes', () => {
    mockPathname = '/explore'
    mockWorkspacePermissionKeys = []

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(mocks.replace).toHaveBeenCalledWith('/apps')
  })

  it('should allow users on non-guarded routes', () => {
    mockPathname = '/plugins'
    mockWorkspacePermissionKeys = []

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('should not block non-guarded routes while workspace is loading', () => {
    mockPathname = '/plugins'
    mockIsLoadingWorkspacePermissionKeys = true

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
