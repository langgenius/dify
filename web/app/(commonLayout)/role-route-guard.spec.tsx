import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
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
}

const baseContext: AppContextMock = {
  isCurrentWorkspaceDatasetOperator: false,
  isLoadingCurrentWorkspace: false,
}

const setAppContext = (overrides: Partial<AppContextMock> = {}) => {
  mockUseAppContext.mockReturnValue({
    ...baseContext,
    ...overrides,
  })
}

const renderRoleRouteGuard = (systemFeatures: { enable_app_deploy?: boolean } = {}) =>
  renderWithSystemFeatures(
    (
      <RoleRouteGuard>
        <div>content</div>
      </RoleRouteGuard>
    ),
    { systemFeatures },
  )

describe('RoleRouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/apps'
    setAppContext()
  })

  it('should render loading while workspace is loading', () => {
    setAppContext({
      isLoadingCurrentWorkspace: true,
    })

    renderRoleRouteGuard()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should redirect dataset operator on guarded routes', async () => {
    setAppContext({
      isCurrentWorkspaceDatasetOperator: true,
    })

    renderRoleRouteGuard()

    expect(screen.queryByText('content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })

  it('should allow dataset operator on non-guarded routes', () => {
    mockPathname = '/plugins'
    setAppContext({
      isCurrentWorkspaceDatasetOperator: true,
    })

    renderRoleRouteGuard()

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should not block non-guarded routes while workspace is loading', () => {
    mockPathname = '/plugins'
    setAppContext({
      isLoadingCurrentWorkspace: true,
    })

    renderRoleRouteGuard()

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should redirect deployments routes when app deploy is disabled', async () => {
    mockPathname = '/deployments'

    renderRoleRouteGuard({ enable_app_deploy: false })

    expect(screen.queryByText('content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('should allow deployments routes when app deploy is enabled', () => {
    mockPathname = '/deployments/app-1/overview'

    renderRoleRouteGuard({ enable_app_deploy: true })

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
