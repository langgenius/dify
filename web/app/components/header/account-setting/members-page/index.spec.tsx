import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace, Member } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useProviderContext } from '@/context/provider-context'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useMembers } from '@/service/use-common'
import MembersPage from './index'

vi.mock('@/context/app-context')
vi.mock('@/context/global-public-context')
vi.mock('@/context/provider-context')
vi.mock('@/hooks/use-format-time-from-now')
vi.mock('@/service/use-common')

vi.mock('./edit-workspace-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div>
      <div>Edit Workspace Modal</div>
      <button onClick={onCancel}>Close Edit Workspace</button>
    </div>
  ),
}))
vi.mock('./invite-button', () => ({
  default: ({ onClick, disabled }: { onClick: () => void, disabled: boolean }) => (
    <button onClick={onClick} disabled={disabled}>Invite</button>
  ),
}))
vi.mock('./invite-modal', () => ({
  default: ({ onCancel, onSend }: { onCancel: () => void, onSend: (results: Array<{ email: string, status: 'success', url: string }>) => void }) => (
    <div>
      <div>Invite Modal</div>
      <button onClick={onCancel}>Close Invite Modal</button>
      <button onClick={() => onSend([{ email: 'sent@example.com', status: 'success', url: 'http://invite/link' }])}>Send Invite Results</button>
    </div>
  ),
}))
vi.mock('./invited-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div>
      <div>Invited Modal</div>
      <button onClick={onCancel}>Close Invited Modal</button>
    </div>
  ),
}))
vi.mock('./operation', () => ({
  default: () => <div>Member Operation</div>,
}))
vi.mock('./operation/transfer-ownership', () => ({
  default: ({ onOperate }: { onOperate: () => void }) => <button onClick={onOperate}>Transfer ownership</button>,
}))
vi.mock('./transfer-ownership-modal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div>
      <div>Transfer Ownership Modal</div>
      <button onClick={onClose}>Close Transfer Modal</button>
    </div>
  ),
}))

describe('MembersPage', () => {
  const mockRefetch = vi.fn()
  const mockFormatTimeFromNow = vi.fn(() => 'just now')

  const mockAccounts: Member[] = [
    {
      id: '1',
      name: 'Owner User',
      email: 'owner@example.com',
      avatar: '',
      avatar_url: '',
      role: 'owner',
      last_active_at: '1731000000',
      last_login_at: '1731000000',
      created_at: '1731000000',
      status: 'active',
    },
    {
      id: '2',
      name: 'Admin User',
      email: 'admin@example.com',
      avatar: '',
      avatar_url: '',
      role: 'admin',
      last_active_at: '1731000000',
      last_login_at: '1731000000',
      created_at: '1731000000',
      status: 'active',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { email: 'owner@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'owner' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: true,
      isCurrentWorkspaceManager: true,
    } as unknown as AppContextValue)

    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: mockAccounts },
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useMembers>)

    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { is_email_setup: true },
    } as unknown as Parameters<typeof selector>[0]))

    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: false,
      isAllowTransferWorkspace: true,
    }))

    vi.mocked(useFormatTimeFromNow).mockReturnValue({
      formatTimeFromNow: mockFormatTimeFromNow,
    })
  })

  it('should render workspace and member information', () => {
    render(<MembersPage />)

    expect(screen.getByText('Test Workspace')).toBeInTheDocument()
    expect(screen.getByText('Owner User')).toBeInTheDocument()
    expect(screen.getByText('Admin User')).toBeInTheDocument()
  })

  it('should open and close invite modal', async () => {
    const user = userEvent.setup()

    render(<MembersPage />)

    await user.click(screen.getByRole('button', { name: /invite/i }))
    expect(screen.getByText('Invite Modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close Invite Modal' }))
    expect(screen.queryByText('Invite Modal')).not.toBeInTheDocument()
  })

  it('should open invited modal after invite results are sent', async () => {
    const user = userEvent.setup()

    render(<MembersPage />)

    await user.click(screen.getByRole('button', { name: /invite/i }))
    await user.click(screen.getByRole('button', { name: 'Send Invite Results' }))

    expect(screen.getByText('Invited Modal')).toBeInTheDocument()
    expect(mockRefetch).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close Invited Modal' }))
    expect(screen.queryByText('Invited Modal')).not.toBeInTheDocument()
  })

  it('should open transfer ownership modal when transfer action is used', async () => {
    const user = userEvent.setup()

    render(<MembersPage />)

    await user.click(screen.getByRole('button', { name: /transfer ownership/i }))
    expect(screen.getByText('Transfer Ownership Modal')).toBeInTheDocument()
  })

  it('should show non-interactive owner role when transfer ownership is not allowed', () => {
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      enableBilling: false,
      isAllowTransferWorkspace: false,
    }))

    render(<MembersPage />)

    expect(screen.getByText('common.members.owner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).not.toBeInTheDocument()
  })

  it('should hide manager controls for non-owner non-manager users', () => {
    vi.mocked(useAppContext).mockReturnValue({
      userProfile: { email: 'admin@example.com' },
      currentWorkspace: { name: 'Test Workspace', role: 'admin' } as ICurrentWorkspace,
      isCurrentWorkspaceOwner: false,
      isCurrentWorkspaceManager: false,
    } as unknown as AppContextValue)

    render(<MembersPage />)

    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Transfer ownership')).not.toBeInTheDocument()
  })
})
