import type { IWorkspace } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import { useWorkspacesContext } from '@/context/workspace-context'
import { switchWorkspace } from '@/service/common'
import WorkplaceSelector from './index'

vi.mock('@/context/workspace-context', () => ({
  useWorkspacesContext: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  switchWorkspace: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/header/plan-badge', () => ({
  default: ({ plan }: { plan: string }) => <div data-testid="plan-badge">{plan}</div>,
}))

describe('WorkplaceSelector', () => {
  const mockWorkspaces: IWorkspace[] = [
    { id: '1', name: 'Workspace 1', current: true, plan: 'professional', status: 'normal', created_at: Date.now() },
    { id: '2', name: 'Workspace 2', current: false, plan: 'sandbox', status: 'normal', created_at: Date.now() },
  ]

  const mockNotify = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useWorkspacesContext).mockReturnValue({
      workspaces: mockWorkspaces,
    })
  })

  const renderComponent = () => {
    return render(
      <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
        <WorkplaceSelector />
      </ToastContext.Provider>,
    )
  }

  it('renders current workspace correctly', () => {
    renderComponent()
    expect(screen.getByText('Workspace 1')).toBeDefined()
    expect(screen.getByText('W')).toBeDefined() // First letter icon
  })

  it('opens menu and displays all workspaces', async () => {
    renderComponent()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getAllByText('Workspace 1').length).toBeGreaterThan(0)
    expect(screen.getByText('Workspace 2')).toBeDefined()
    expect(screen.getAllByTestId('plan-badge')).toHaveLength(2)
  })

  it('switches workspace successfully', async () => {
    vi.mocked(switchWorkspace).mockResolvedValue({
      result: 'success',
      new_tenant: mockWorkspaces[1],
    })
    renderComponent()

    fireEvent.click(screen.getByRole('button'))
    const workspace2 = screen.getByText('Workspace 2')
    fireEvent.click(workspace2)

    expect(switchWorkspace).toHaveBeenCalledWith({
      url: '/workspaces/switch',
      body: { tenant_id: '2' },
    })

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'actionMsg.modifiedSuccessfully',
      })
    })
  })

  it('does not switch to the already current workspace', async () => {
    renderComponent()

    fireEvent.click(screen.getByRole('button'))
    const workspacesInMenu = screen.getAllByText('Workspace 1')
    fireEvent.click(workspacesInMenu[workspacesInMenu.length - 1])

    expect(switchWorkspace).not.toHaveBeenCalled()
  })

  it('handles switching error', async () => {
    vi.mocked(switchWorkspace).mockRejectedValue(new Error('Failed'))
    renderComponent()

    fireEvent.click(screen.getByRole('button'))
    const workspace2 = screen.getByText('Workspace 2')
    fireEvent.click(workspace2)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'provider.saveFailed',
      })
    })
  })
})
