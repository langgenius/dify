import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RoleRouteGuard from './role-route-guard'

const mockReplace = vi.fn()
const mockUseAppContext = vi.fn()
let mockPathname = '/apps'

vi.mock('next/navigation', () => ({
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

    render((
      <RoleRouteGuard>
        <div data-testid="guarded-content">content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByTestId('guarded-content')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should redirect dataset operator on guarded routes', async () => {
    setAppContext({
      isCurrentWorkspaceDatasetOperator: true,
    })

    render((
      <RoleRouteGuard>
        <div data-testid="guarded-content">content</div>
      </RoleRouteGuard>
    ))

    expect(screen.queryByTestId('guarded-content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })

  it('should allow dataset operator on non-guarded routes', () => {
    mockPathname = '/plugins'
    setAppContext({
      isCurrentWorkspaceDatasetOperator: true,
    })

    render((
      <RoleRouteGuard>
        <div data-testid="guarded-content">content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByTestId('guarded-content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should not block non-guarded routes while workspace is loading', () => {
    mockPathname = '/plugins'
    setAppContext({
      isLoadingCurrentWorkspace: true,
    })

    render((
      <RoleRouteGuard>
        <div data-testid="guarded-content">content</div>
      </RoleRouteGuard>
    ))

    expect(screen.getByTestId('guarded-content')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
