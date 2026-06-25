import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { RoleRouteGuard } from '../role-route-guard'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  currentWorkspaceQueryOptions: vi.fn(() => ({ queryKey: ['console', 'workspaces', 'current', 'post'] })),
  systemFeaturesQueryKey: vi.fn(() => ['console', 'systemFeatures', 'get']),
}))

let mockPathname = '/apps'

vi.mock('@/next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
  usePathname: () => mockPathname,
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
    systemFeatures: {
      get: {
        queryKey: mocks.systemFeaturesQueryKey,
      },
    },
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

function renderGuard(children: ReactNode) {
  return renderWithSystemFeatures(
    <RoleRouteGuard>
      {children}
    </RoleRouteGuard>,
    {
      systemFeatures: {
        enable_app_deploy: true,
      },
    },
  )
}

const setCurrentWorkspaceQuery = (overrides: { role?: string, isPending?: boolean } = {}) => {
  mockUseQuery.mockReturnValue({
    data: overrides.role,
    isPending: overrides.isPending ?? false,
  } as ReturnType<typeof useQuery>)
}

describe('RoleRouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/app/app-1'
    setCurrentWorkspaceQuery()
  })

  it.each(['/', '/apps', '/app/app-1', '/deployments/create', '/snippets', '/explore/apps', '/tools', '/integrations', '/datasets'])('should allow %s without workspace role checks', (pathname) => {
    mockPathname = pathname

    renderGuard(<div>content</div>)

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mockUseQuery).not.toHaveBeenCalled()
    expect(mocks.currentWorkspaceQueryOptions).not.toHaveBeenCalled()
  })

  it('should redirect deployments route when app deploy is disabled', () => {
    mockPathname = '/deployments/create'

    expect(() => renderWithSystemFeatures(
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>,
      {
        systemFeatures: {
          enable_app_deploy: false,
        },
      },
    )).toThrow('NEXT_REDIRECT:/apps')

    expect(mocks.redirect).toHaveBeenCalledWith('/apps')
    expect(mockUseQuery).not.toHaveBeenCalled()
    expect(mocks.currentWorkspaceQueryOptions).not.toHaveBeenCalled()
  })
})
