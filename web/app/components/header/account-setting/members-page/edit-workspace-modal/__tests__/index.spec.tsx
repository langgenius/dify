import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { consoleClient } from '@/service/console'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import EditWorkspaceModal from '../index'

const toastMocks = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}))
let isOwner = true

const getSaveButton = () => screen.getByRole('button', { name: /operation\.(save|saving)/i })

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: (await import('@/test/console/service-responses')).withConsoleClientResponses(
    (await importOriginal<typeof import('@/service/console')>()).consoleClient,
    { 'workspaces.info.post': vi.fn() },
  ),
}))
vi.mock('@/app/notifications', () => ({
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

    isOwner = true
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const renderModal = () =>
    render(
      <>
        <EditWorkspaceModal onCancel={mockOnCancel} />
      </>,
      { currentWorkspace: { name: 'Test Workspace', role: isOwner ? 'owner' : 'normal' } },
    )

  it('should submit update when confirming as owner', async () => {
    const user = userEvent.setup()
    const mockAssign = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      assign: mockAssign,
      origin: 'http://localhost',
    })
    vi.mocked(consoleClient.workspaces.info.post).mockResolvedValue({
      result: 'success',
      tenant: { id: 'workspace-id' },
    })

    renderModal()

    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Renamed Workspace')
    await user.click(getSaveButton())

    await waitFor(() => {
      expect(consoleClient.workspaces.info.post).toHaveBeenCalledWith({
        body: { name: 'Renamed Workspace' },
      })
      expect(mockAssign).toHaveBeenCalledWith('http://localhost')
    })

    expect(mockOnCancel).not.toHaveBeenCalled()
  })

  it('should expose the saving label and prevent duplicate form submission', async () => {
    const user = userEvent.setup()
    let rejectUpdate!: (reason: Error) => void
    vi.mocked(consoleClient.workspaces.info.post).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectUpdate = reject
        }),
    )
    renderModal()
    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Renamed Workspace')

    await user.click(getSaveButton())

    const savingButton = screen.getByRole('button', { name: /operation\.saving/i })
    expect(savingButton).toHaveAttribute('aria-disabled', 'true')
    fireEvent.submit(savingButton.closest('form')!)
    expect(consoleClient.workspaces.info.post).toHaveBeenCalledOnce()

    rejectUpdate(new Error('update failed'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /operation\.save/i })).toBeEnabled()
    })
  })

  it('should show error toast when update fails', async () => {
    const user = userEvent.setup()

    vi.mocked(consoleClient.workspaces.info.post).mockRejectedValue(new Error('update failed'))

    renderModal()

    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Broken Workspace')
    await user.click(getSaveButton())

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        }),
      )
    })
  })

  it('should disable save button and show error when the name is empty', async () => {
    const user = userEvent.setup()

    renderModal()

    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)

    expect(getSaveButton()).toBeDisabled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('should not submit when the form is submitted while save is disabled', async () => {
    renderModal()

    const saveButton = getSaveButton()
    const form = saveButton.closest('form')

    expect(saveButton).toBeDisabled()
    expect(form).not.toBeNull()

    fireEvent.submit(form!)

    expect(consoleClient.workspaces.info.post).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('prevents a non-owner from submitting a changed workspace name', async () => {
    isOwner = false

    renderModal()

    const user = userEvent.setup()
    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Unauthorized rename')
    expect(getSaveButton()).toBeDisabled()
    await user.click(getSaveButton())
    expect(consoleClient.workspaces.info.post).not.toHaveBeenCalled()
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
