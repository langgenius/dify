import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceInfo } from '@/service/common'
import EditWorkspaceModal from '../index'

const toastMocks = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}))

const getSaveButton = () => screen.getByRole('button', { name: /operation\.(save|saving)/i })

vi.mock('@/context/app-context')
vi.mock('@/service/common')
vi.mock('@langgenius/dify-ui/toast', () => ({
  default: {
    notify: (args: unknown) => toastMocks.mockNotify(args),
  },
  toast: {
    success: (message: string) => toastMocks.mockNotify({ type: 'success', message }),
    error: (message: string) => toastMocks.mockNotify({ type: 'error', message }),
    warning: (message: string) => toastMocks.mockNotify({ type: 'warning', message }),
    info: (message: string) => toastMocks.mockNotify({ type: 'info', message }),
  },
}))

describe('EditWorkspaceModal', () => {
  const mockOnCancel = vi.fn()
  const { mockNotify } = toastMocks

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
    <>
      <EditWorkspaceModal onCancel={mockOnCancel} />
    </>,
  )

  it('should show current workspace name in the input', async () => {
    renderModal()

    expect(await screen.findByDisplayValue('Test Workspace')).toBeInTheDocument()
  })

  it('should render on the dify-ui overlay layer', async () => {
    renderModal()

    expect(await screen.findByRole('dialog')).toHaveClass('z-50')
  })

  it('should let user edit workspace name', async () => {
    const user = userEvent.setup()

    renderModal()

    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'New Workspace Name')

    expect(input).toHaveValue('New Workspace Name')
  })

  it('should submit update when confirming as owner', async () => {
    const user = userEvent.setup()
    const mockAssign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign: mockAssign, origin: 'http://localhost' })
    vi.mocked(updateWorkspaceInfo).mockResolvedValue({} as ICurrentWorkspace)

    renderModal()

    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Renamed Workspace')
    await user.click(getSaveButton())

    await waitFor(() => {
      expect(updateWorkspaceInfo).toHaveBeenCalledWith({
        url: '/workspaces/info',
        body: { name: 'Renamed Workspace' },
      })
      expect(mockAssign).toHaveBeenCalledWith('http://localhost')
    })

    expect(mockOnCancel).not.toHaveBeenCalled()
  })

  it('should show error toast when update fails', async () => {
    const user = userEvent.setup()

    vi.mocked(updateWorkspaceInfo).mockRejectedValue(new Error('update failed'))

    renderModal()

    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Broken Workspace')
    await user.click(getSaveButton())

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
      }))
    })
  })

  it('should disable save button when there are no changes', async () => {
    renderModal()

    expect(getSaveButton()).toBeDisabled()
  })

  it('should disable save button and show error when the name is empty', async () => {
    const user = userEvent.setup()

    renderModal()

    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)

    expect(getSaveButton()).toBeDisabled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('edit-workspace-error')).toBeInTheDocument()
  })

  it('should not submit when the form is submitted while save is disabled', async () => {
    renderModal()

    const saveButton = getSaveButton()
    const form = saveButton.closest('form')

    expect(saveButton).toBeDisabled()
    expect(form).not.toBeNull()

    fireEvent.submit(form!)

    expect(updateWorkspaceInfo).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('should disable confirm button for non-owners', async () => {
    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { name: 'Test Workspace' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
    } as unknown as AppContextValue)

    renderModal()

    expect(getSaveButton()).toBeDisabled()
  })

  it('should call onCancel when close icon is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /Close|operation.close/ }))
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /operation\.cancel/i }))
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onCancel when Escape key is pressed', async () => {
    renderModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })
})
