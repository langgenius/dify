import { useQuery } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RoleRouteGuard from '../role-route-guard'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  currentWorkspaceQueryOptions: vi.fn(() => ({ queryKey: ['console', 'workspaces', 'current', 'post'] })),
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
    setCurrentWorkspaceQuery()
  })

  it('should render loading while workspace is loading', () => {
    setCurrentWorkspaceQuery({ isPending: true })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.currentWorkspaceQueryOptions).toHaveBeenCalledWith({
      select: expect.any(Function),
    })
  })

  it('should redirect dataset operator on guarded routes', () => {
    setCurrentWorkspaceQuery({ role: 'dataset_operator' })

    expect(() => render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))).toThrow('NEXT_REDIRECT:/datasets')

    expect(mocks.redirect).toHaveBeenCalledWith('/datasets')
  })

  it('should allow dataset operator on non-guarded routes', () => {
    mockPathname = '/plugins'
    setCurrentWorkspaceQuery({ role: 'dataset_operator' })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('should not block non-guarded routes while workspace is loading', () => {
    mockPathname = '/plugins'
    setCurrentWorkspaceQuery({ isPending: true })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
