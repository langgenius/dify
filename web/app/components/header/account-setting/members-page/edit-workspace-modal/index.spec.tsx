import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceInfo } from '@/service/common'
import EditWorkspaceModal from './index'

vi.mock('@/context/app-context')
vi.mock('@/service/common')

describe('EditWorkspaceModal', () => {
  const mockOnCancel = vi.fn()
  const mockNotify = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { name: 'Test Workspace' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: true,
    } as unknown as AppContextValue)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const renderModal = () => render(
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      <EditWorkspaceModal onCancel={mockOnCancel} />
    </ToastContext.Provider>,
  )

  it('should show current workspace name in the input', async () => {
    renderModal()

    expect(await screen.findByDisplayValue('Test Workspace')).toBeInTheDocument()
  })

  it('should let user edit workspace name', async () => {
    const user = userEvent.setup()

    renderModal()

    const input = screen.getByPlaceholderText(/account\.workspaceNamePlaceholder/i)
    await user.clear(input)
    await user.type(input, 'New Workspace Name')

    expect(input).toHaveValue('New Workspace Name')
  })

  it('should reset name to current workspace name when cleared', async () => {
    const user = userEvent.setup()

    renderModal()

    const input = screen.getByPlaceholderText(/account\.workspaceNamePlaceholder/i)
    await user.clear(input)
    await user.type(input, 'New Workspace Name')
    expect(input).toHaveValue('New Workspace Name')

    // Click the clear button (Input component clear button)
    const clearBtn = screen.getByTestId('input-clear')
    await user.click(clearBtn)

    expect(input).toHaveValue('Test Workspace')
  })

  it('should submit update when confirming as owner', async () => {
    const user = userEvent.setup()
    const mockAssign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign: mockAssign, origin: 'http://localhost' })
    vi.mocked(updateWorkspaceInfo).mockResolvedValue({} as ICurrentWorkspace)

    renderModal()

    const input = screen.getByPlaceholderText(/account\.workspaceNamePlaceholder/i)
    await user.clear(input)
    await user.type(input, 'Renamed Workspace')
    await user.click(screen.getByTestId('edit-workspace-confirm'))

    await waitFor(() => {
      expect(updateWorkspaceInfo).toHaveBeenCalledWith({
        url: '/workspaces/info',
        body: { name: 'Renamed Workspace' },
      })
      expect(mockAssign).toHaveBeenCalledWith('http://localhost')
    })
  })

  it('should show error toast when update fails', async () => {
    const user = userEvent.setup()

    vi.mocked(updateWorkspaceInfo).mockRejectedValue(new Error('update failed'))

    renderModal()

    await user.click(screen.getByTestId('edit-workspace-confirm'))

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
      }))
    })
  })

  it('should disable confirm button for non-owners', async () => {
    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { name: 'Test Workspace' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
    } as unknown as AppContextValue)

    renderModal()

    expect(screen.getByTestId('edit-workspace-confirm')).toBeDisabled()
  })

  it('should call onCancel when close icon is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByTestId('edit-workspace-close'))
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByTestId('edit-workspace-cancel'))
    expect(mockOnCancel).toHaveBeenCalled()
  })
})
