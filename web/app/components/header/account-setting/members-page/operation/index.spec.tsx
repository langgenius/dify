import type { Member } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import Operation from './index'

const mockUpdateMemberRole = vi.fn()
const mockDeleteMemberOrCancelInvitation = vi.fn()

vi.mock('@/service/common', () => ({
  deleteMemberOrCancelInvitation: () => mockDeleteMemberOrCancelInvitation(),
  updateMemberRole: () => mockUpdateMemberRole(),
}))

const mockUseProviderContext = vi.fn(() => ({
  datasetOperatorEnabled: false,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

const defaultMember: Member = {
  id: 'member-id',
  name: 'Test Member',
  email: 'test@example.com',
  avatar: '',
  avatar_url: null,
  status: 'active',
  role: 'editor',
  last_login_at: '',
  last_active_at: '',
  created_at: '',
}

const renderOperation = (propsOverride: Partial<Member> = {}, operatorRole = 'owner', onOperate?: () => void) => {
  const mergedMember = { ...defaultMember, ...propsOverride }
  return render(
    <ToastContext.Provider value={{ notify: vi.fn(), close: vi.fn() }}>
      <Operation member={mergedMember} operatorRole={operatorRole} onOperate={onOperate ?? vi.fn()} />
    </ToastContext.Provider>,
  )
}

describe('Operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({ datasetOperatorEnabled: false })
  })

  it('renders the current role label', () => {
    renderOperation()

    expect(screen.getByText('common.members.editor')).toBeInTheDocument()
  })

  it('shows dataset operator option when the feature flag is enabled', async () => {
    const user = userEvent.setup()

    mockUseProviderContext.mockReturnValue({ datasetOperatorEnabled: true })
    renderOperation()

    await user.click(screen.getByText('common.members.editor'))

    expect(await screen.findByText('common.members.datasetOperator')).toBeInTheDocument()
  })

  it('shows owner-allowed role options for admin operators', async () => {
    const user = userEvent.setup()

    renderOperation({}, 'admin')

    await user.click(screen.getByText('common.members.editor'))

    expect(screen.queryByText('common.members.admin')).not.toBeInTheDocument()
    expect(screen.getByText('common.members.normal')).toBeInTheDocument()
  })

  it('does not show role options for unsupported operators', async () => {
    const user = userEvent.setup()

    renderOperation({}, 'normal')

    await user.click(screen.getByText('common.members.editor'))

    expect(screen.queryByText('common.members.normal')).not.toBeInTheDocument()
    expect(screen.getByText('common.members.removeFromTeam')).toBeInTheDocument()
  })

  it('calls updateMemberRole and onOperate when selecting another role', async () => {
    const user = userEvent.setup()
    const onOperate = vi.fn()
    renderOperation({}, 'owner', onOperate)

    await user.click(screen.getByText('common.members.editor'))
    await user.click(await screen.findByText('common.members.normal'))

    await waitFor(() => {
      expect(mockUpdateMemberRole).toHaveBeenCalled()
      expect(onOperate).toHaveBeenCalled()
    })
  })

  it('calls deleteMemberOrCancelInvitation when removing the member', async () => {
    const user = userEvent.setup()
    const onOperate = vi.fn()
    renderOperation({}, 'owner', onOperate)

    await user.click(screen.getByText('common.members.editor'))
    await user.click(await screen.findByText('common.members.removeFromTeam'))

    await waitFor(() => {
      expect(mockDeleteMemberOrCancelInvitation).toHaveBeenCalled()
      expect(onOperate).toHaveBeenCalled()
    })
  })
})
