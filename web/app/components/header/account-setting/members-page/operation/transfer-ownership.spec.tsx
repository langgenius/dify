import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useWorkspacePermissions } from '@/service/use-workspace'
import TransferOwnership from './transfer-ownership'

vi.mock('@/context/app-context')
vi.mock('@/context/global-public-context')
vi.mock('@/service/use-workspace')

const TransferOwnershipHarness = () => {
  const [opened, setOpened] = useState(false)
  return (
    <>
      <TransferOwnership onOperate={() => setOpened(true)} />
      {opened && <div>Transfer dialog opened</div>}
    </>
  )
}

describe('TransferOwnership', () => {
  const setupMocks = ({
    brandingEnabled,
    isFetching,
    allowOwnerTransfer,
  }: {
    brandingEnabled: boolean
    isFetching: boolean
    allowOwnerTransfer?: boolean
  }) => {
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { branding: { enabled: brandingEnabled } },
    } as unknown as Parameters<typeof selector>[0]))
    vi.mocked(useWorkspacePermissions).mockReturnValue({
      data: allowOwnerTransfer === undefined ? null : { allow_owner_transfer: allowOwnerTransfer },
      isFetching,
    } as unknown as ReturnType<typeof useWorkspacePermissions>)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { id: 'workspace-id' } as ICurrentWorkspace,
    } as unknown as AppContextValue)
  })

  it('should show loading status while permissions are loading', () => {
    setupMocks({ brandingEnabled: true, isFetching: true })

    render(<TransferOwnershipHarness />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should show owner text without transfer menu when transfer is forbidden', () => {
    setupMocks({ brandingEnabled: true, isFetching: false, allowOwnerTransfer: false })

    render(<TransferOwnershipHarness />)

    expect(screen.getByText(/members\.owner/i)).toBeInTheDocument()
    expect(screen.queryByText(/members\.transferOwnership/i)).toBeNull()
  })

  it('should open transfer dialog when transfer option is selected', async () => {
    const user = userEvent.setup()

    setupMocks({ brandingEnabled: true, isFetching: false, allowOwnerTransfer: true })

    render(<TransferOwnershipHarness />)

    await user.click(screen.getByRole('button', { name: /members\.owner/i }))
    await user.click(screen.getByText(/members\.transferOwnership/i))

    expect(screen.getByText('Transfer dialog opened')).toBeInTheDocument()
  })

  it('should allow transfer menu when branding is disabled', async () => {
    const user = userEvent.setup()

    setupMocks({ brandingEnabled: false, isFetching: false })

    render(<TransferOwnershipHarness />)

    await user.click(screen.getByRole('button', { name: /members\.owner/i }))

    expect(screen.getByText(/members\.transferOwnership/i)).toBeInTheDocument()
  })
})
