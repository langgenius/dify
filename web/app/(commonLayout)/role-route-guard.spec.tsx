import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RoleRouteGuard from './role-route-guard'

const mockReplace = vi.fn()
const mockUseAppContext = vi.fn()
let mockPathname = '/apps'

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
}))

type AppContextMock = {
  isCurrentWorkspaceDatasetOperator: boolean
  isLoadingCurrentWorkspace: boolean
  isLoadingWorkspacePermissionKeys: boolean
  workspacePermissionKeys: string[]
}

const baseContext: AppContextMock = {
  isCurrentWorkspaceDatasetOperator: false,
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  workspacePermissionKeys: ['app_library.access', 'tool.manage'],
}

const setAppContext = (overrides: Partial<AppContextMock> = {}) => {
  mockUseAppContext.mockReturnValue({
    ...baseContext,
    ...overrides,
  })
}

describe('RoleRouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/apps'
    setAppContext()
  })

  it('should render loading while workspace is loading on guarded routes', () => {
    mockPathname = '/explore/apps'
    setAppContext({
      isLoadingCurrentWorkspace: true,
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should render loading while workspace permission keys are loading on guarded routes', () => {
    mockPathname = '/tools'
    setAppContext({
      isLoadingWorkspacePermissionKeys: true,
      workspacePermissionKeys: [],
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should redirect explore route without app library access to an accessible page', async () => {
    mockPathname = '/explore/apps'
    setAppContext({
      workspacePermissionKeys: [],
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.queryByText('content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('should redirect tools route without tool or MCP management access to an accessible page', async () => {
    mockPathname = '/tools'
    setAppContext({
      workspacePermissionKeys: [],
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.queryByText('content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('should allow datasets routes without a page-level dataset permission', () => {
    mockPathname = '/datasets'
    setAppContext({
      workspacePermissionKeys: [],
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should allow guarded routes when workspace has the matching page access', () => {
    mockPathname = '/tools'
    setAppContext({
      workspacePermissionKeys: ['tool.manage'],
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should allow tools routes when workspace has MCP management access', () => {
    mockPathname = '/tools'
    setAppContext({
      workspacePermissionKeys: ['mcp.manage'],
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should allow explore routes when workspace has app library access', () => {
    mockPathname = '/explore/apps'
    setAppContext({
      workspacePermissionKeys: ['app_library.access'],
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should allow users on non-guarded routes', () => {
    mockPathname = '/plugins'
    setAppContext({
      isCurrentWorkspaceDatasetOperator: true,
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should not block non-guarded routes while workspace is loading', () => {
    mockPathname = '/plugins'
    setAppContext({
      isLoadingCurrentWorkspace: true,
    })

    render((
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
