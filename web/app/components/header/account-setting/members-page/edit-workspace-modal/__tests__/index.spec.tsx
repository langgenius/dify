import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { updateWorkspaceInfo } from '@/service/common'
import { render } from '@/test/console/render'
import { EditWorkspaceDialog } from '../index'

const toastMocks = vi.hoisted(() => ({ mockNotify: vi.fn() }))
const mockConsoleState = vi.hoisted(() => ({
  current: {} as Partial<ConsoleStateFixture>,
}))

const getSaveButton = () => screen.getByRole('button', { name: /operation\.(save|saving)/i })
const getTrigger = () => screen.getByRole('button', { name: /account\.editWorkspaceInfo/i })

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState.current)
})
vi.mock('@/service/common', () => ({ updateWorkspaceInfo: vi.fn() }))
vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => toastMocks.mockNotify({ type: 'success', message }),
    error: (message: string) => toastMocks.mockNotify({ type: 'error', message }),
  },
}))

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  render(<EditWorkspaceDialog />)
  await user.click(getTrigger())
}

describe('EditWorkspaceDialog', () => {
  beforeEach(() => {
    vi.mocked(updateWorkspaceInfo).mockReset()
    mockConsoleState.current = {
      currentWorkspace: { name: 'Test Workspace' },
      isCurrentWorkspaceOwner: true,
    } as unknown as ConsoleStateFixture
  })

  afterEach(() => vi.unstubAllGlobals())

  it('opens a named dialog with the current workspace name and an unavailable unchanged save', async () => {
    const user = userEvent.setup()
    await openDialog(user)

    expect(screen.getByRole('dialog', { name: /account\.editWorkspaceInfo/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/account\.workspaceName/i)).toHaveValue('Test Workspace')
    expect(getSaveButton()).toBeDisabled()
  })

  it('saves the trimmed name through the existing endpoint and reloads the origin', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' })
    vi.mocked(updateWorkspaceInfo).mockResolvedValue({
      result: 'success',
      tenant: { id: 'workspace-id' },
    })
    await openDialog(user)
    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, ' Renamed Workspace {Enter}')

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost'))
    expect(updateWorkspaceInfo).toHaveBeenCalledExactlyOnceWith({
      url: '/workspaces/info',
      body: { name: 'Renamed Workspace' },
    })
    expect(toastMocks.mockNotify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.actionMsg.modifiedSuccessfully',
    })
  })

  it('blocks dismissal and duplicate submission while saving, then keeps the failed draft for retry', async () => {
    const user = userEvent.setup()
    let rejectUpdate!: (reason: Error) => void
    vi.mocked(updateWorkspaceInfo).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectUpdate = reject
        }),
    )
    await openDialog(user)
    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Renamed Workspace')
    await user.click(getSaveButton())

    const saving = screen.getByRole('button', { name: /operation\.saving/i })
    const cancel = screen.getByRole('button', { name: /operation\.cancel/i })
    const close = screen.getByRole('button', { name: /operation\.close/i })
    expect(saving).toHaveAttribute('aria-disabled', 'true')
    expect(input).toHaveAttribute('readonly')
    expect(cancel).toBeDisabled()
    expect(close).toBeDisabled()
    await user.click(cancel)
    await user.click(close)
    await user.keyboard('{Escape}{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(updateWorkspaceInfo).toHaveBeenCalledOnce()

    rejectUpdate(new Error('update failed'))
    await waitFor(() => expect(getSaveButton()).not.toHaveAttribute('aria-disabled', 'true'))
    expect(input).toHaveValue('Renamed Workspace')
    expect(input).not.toHaveAttribute('readonly')
    expect(toastMocks.mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'common.actionMsg.modifiedUnsuccessfully',
    })
    vi.mocked(updateWorkspaceInfo).mockRejectedValueOnce(new Error('retry failed'))
    await user.click(input)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(updateWorkspaceInfo).toHaveBeenCalledTimes(2))
    expect(vi.mocked(updateWorkspaceInfo).mock.calls[1]).toEqual(
      vi.mocked(updateWorkspaceInfo).mock.calls[0],
    )
    await waitFor(() => expect(cancel).toBeEnabled())
  })

  it('shows the required name error and prevents an empty submission', async () => {
    const user = userEvent.setup()
    await openDialog(user)
    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, '   {Enter}')

    expect(getSaveButton()).toBeDisabled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(updateWorkspaceInfo).not.toHaveBeenCalled()
  })

  it('guards a programmatic submission when the name is unchanged', async () => {
    const user = userEvent.setup()
    await openDialog(user)
    fireEvent.submit(getSaveButton().closest('form')!)

    expect(updateWorkspaceInfo).not.toHaveBeenCalled()
    expect(toastMocks.mockNotify).not.toHaveBeenCalled()
  })

  it('keeps the existing save permission guard for non-owners', async () => {
    const user = userEvent.setup()
    mockConsoleState.current = { ...mockConsoleState.current, isCurrentWorkspaceOwner: false }
    await openDialog(user)
    const input = screen.getByLabelText(/account\.workspaceName/i)
    await user.clear(input)
    await user.type(input, 'Unauthorized rename{Enter}')

    expect(getSaveButton()).toBeDisabled()
    expect(updateWorkspaceInfo).not.toHaveBeenCalled()
  })

  it.each(['close', 'cancel', 'Escape'] as const)(
    'discards the draft after %s and reopens from the workspace name',
    async (dismissal) => {
      const user = userEvent.setup()
      await openDialog(user)
      const input = screen.getByLabelText(/account\.workspaceName/i)
      await user.clear(input)
      await user.type(input, 'Unsaved Workspace')
      if (dismissal === 'Escape') await user.keyboard('{Escape}')
      else
        await user.click(
          screen.getByRole('button', { name: new RegExp(`operation\\.${dismissal}`, 'i') }),
        )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(getTrigger())

      expect(screen.getByLabelText(/account\.workspaceName/i)).toHaveValue('Test Workspace')
      expect(updateWorkspaceInfo).not.toHaveBeenCalled()
    },
  )
})
