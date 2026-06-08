import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { useAppContext } from '@/context/app-context'
import { useWorkspacePermissions } from '@/service/use-workspace'
import TransferOwnership from '../transfer-ownership'

vi.mock('@/context/app-context')
vi.mock('@/service/use-workspace')

describe('TransferOwnership', () => {
  const setupPermissions = ({
    isFetching,
    allowOwnerTransfer,
  }: {
    isFetching: boolean
    allowOwnerTransfer?: boolean
  }) => {
    vi.mocked(useWorkspacePermissions).mockReturnValue({
      data: allowOwnerTransfer === undefined ? null : { allow_owner_transfer: allowOwnerTransfer },
      isFetching,
    } as unknown as ReturnType<typeof useWorkspacePermissions>)
  }

  const renderTransferOwnership = (
    brandingEnabled: boolean,
    onOperate: () => void = vi.fn(),
  ) =>
    renderWithSystemFeatures(<TransferOwnership onOperate={onOperate} />, {
      systemFeatures: { branding: { enabled: brandingEnabled } },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { id: 'workspace-id' } as ICurrentWorkspace,
    } as unknown as AppContextValue)
  })

  it('should show loading status while permissions are loading', () => {
    setupPermissions({ isFetching: true })

    renderTransferOwnership(true)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should show owner text without transfer menu when transfer is forbidden', () => {
    setupPermissions({ isFetching: false, allowOwnerTransfer: false })

    renderTransferOwnership(true)

    expect(screen.getByText(/members\.owner/i)).toBeInTheDocument()
    expect(screen.queryByText(/members\.transferOwnership/i)).toBeNull()
  })

  it('should open transfer dialog when transfer option is selected', async () => {
    const user = userEvent.setup()
    const onOperate = vi.fn()

    setupPermissions({ isFetching: false, allowOwnerTransfer: true })

    renderTransferOwnership(true, onOperate)

    await user.click(screen.getByRole('button', { name: /members\.owner/i }))
    const transferOptionText = await screen.findByText(/members\.transferOwnership/i)
    const transferOption = transferOptionText.closest('div.cursor-pointer')
    if (!transferOption)
      throw new Error('Transfer option container not found')
    fireEvent.click(transferOption)

    await waitFor(() => {
      expect(onOperate).toHaveBeenCalledTimes(1)
    })
  })

  it('should allow transfer menu when branding is disabled', async () => {
    const user = userEvent.setup()

    setupPermissions({ isFetching: false })

    renderTransferOwnership(false)

    await user.click(screen.getByRole('button', { name: /members\.owner/i }))

    expect(screen.getByText(/members\.transferOwnership/i)).toBeInTheDocument()
  })
})
