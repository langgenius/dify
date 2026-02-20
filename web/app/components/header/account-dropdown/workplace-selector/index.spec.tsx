import type { ProviderContextState } from '@/context/provider-context'
import type { IWorkspace } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastContext } from '@/app/components/base/toast'
import { baseProviderContextValue, useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { switchWorkspace } from '@/service/common'
import WorkplaceSelector from './index'

vi.mock('@/context/workspace-context', () => ({
  useWorkspacesContext: vi.fn(),
}))

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/service/common', () => ({
  switchWorkspace: vi.fn(),
}))

describe('WorkplaceSelector', () => {
  const mockWorkspaces: IWorkspace[] = [
    { id: '1', name: 'Workspace 1', current: true, plan: 'professional', status: 'normal', created_at: Date.now() },
    { id: '2', name: 'Workspace 2', current: false, plan: 'sandbox', status: 'normal', created_at: Date.now() },
  ]

  const mockNotify = vi.fn()
  const mockAssign = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useWorkspacesContext).mockReturnValue({
      workspaces: mockWorkspaces,
    })
    vi.mocked(useProviderContext).mockReturnValue({
      ...baseProviderContextValue,
      isFetchedPlan: true,
      isEducationWorkspace: false,
    } as ProviderContextState)
    vi.stubGlobal('location', { ...window.location, assign: mockAssign })
  })

  const renderComponent = () => {
    return render(
      <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
        <WorkplaceSelector />
      </ToastContext.Provider>,
    )
  }

  describe('Rendering', () => {
    it('should render current workspace correctly', () => {
      // Act
      renderComponent()

      // Assert
      expect(screen.getByText('Workspace 1')).toBeInTheDocument()
      expect(screen.getByText('W')).toBeInTheDocument() // First letter icon
    })

    it('should open menu and display all workspaces when clicked', () => {
      // Act
      renderComponent()
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(screen.getAllByText('Workspace 1').length).toBeGreaterThan(0)
      expect(screen.getByText('Workspace 2')).toBeInTheDocument()
      // The real PlanBadge renders uppercase plan name or "pro"
      expect(screen.getByText('pro')).toBeInTheDocument()
      expect(screen.getByText('sandbox')).toBeInTheDocument()
    })
  })

  describe('Workspace Switching', () => {
    it('should switch workspace successfully', async () => {
      // Arrange
      vi.mocked(switchWorkspace).mockResolvedValue({
        result: 'success',
        new_tenant: mockWorkspaces[1],
      })

      // Act
      renderComponent()
      fireEvent.click(screen.getByRole('button'))
      const workspace2 = screen.getByText('Workspace 2')
      fireEvent.click(workspace2)

      // Assert
      expect(switchWorkspace).toHaveBeenCalledWith({
        url: '/workspaces/switch',
        body: { tenant_id: '2' },
      })

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.actionMsg.modifiedSuccessfully',
        })
        expect(mockAssign).toHaveBeenCalled()
      })
    })

    it('should not switch to the already current workspace', () => {
      // Act
      renderComponent()
      fireEvent.click(screen.getByRole('button'))
      const workspacesInMenu = screen.getAllByText('Workspace 1')
      fireEvent.click(workspacesInMenu[workspacesInMenu.length - 1])

      // Assert
      expect(switchWorkspace).not.toHaveBeenCalled()
    })

    it('should handle switching error correctly', async () => {
      // Arrange
      vi.mocked(switchWorkspace).mockRejectedValue(new Error('Failed'))

      // Act
      renderComponent()
      fireEvent.click(screen.getByRole('button'))
      const workspace2 = screen.getByText('Workspace 2')
      fireEvent.click(workspace2)

      // Assert
      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.provider.saveFailed',
        })
      })
    })
  })
})
