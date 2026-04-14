import type { Member } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import Operation from '../index'

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
    <>
      <Operation member={mergedMember} operatorRole={operatorRole} onOperate={onOperate ?? vi.fn()} />
    </>,
  )
}

describe('Operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({ datasetOperatorEnabled: false })
  })

  it('should render the current role label when member has editor role', () => {
    renderOperation()

    expect(screen.getByText('common.members.editor')).toBeInTheDocument()
  })

  it('should show dataset operator option when feature flag is enabled', async () => {
    const user = userEvent.setup()

    mockUseProviderContext.mockReturnValue({ datasetOperatorEnabled: true })
    renderOperation()

    await user.click(screen.getByText('common.members.editor'))

    expect(await screen.findByText('common.members.datasetOperator')).toBeInTheDocument()
  })

  it('should show owner-allowed role options when operator role is admin', async () => {
    const user = userEvent.setup()

    renderOperation({}, 'admin')

    await user.click(screen.getByText('common.members.editor'))

    expect(screen.queryByText('common.members.admin')).not.toBeInTheDocument()
    expect(screen.getByText('common.members.normal')).toBeInTheDocument()
  })

  it('should not show role options when operator role is unsupported', async () => {
    const user = userEvent.setup()

    renderOperation({}, 'normal')

    await user.click(screen.getByText('common.members.editor'))

    expect(screen.queryByText('common.members.normal')).not.toBeInTheDocument()
    expect(screen.getByText('common.members.removeFromTeam')).toBeInTheDocument()
  })

  it('should call updateMemberRole and onOperate when selecting another role', async () => {
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

  it('should show dataset operator option when operator is admin and feature flag is enabled', async () => {
    const user = userEvent.setup()
    mockUseProviderContext.mockReturnValue({ datasetOperatorEnabled: true })
    renderOperation({}, 'admin')

    await user.click(screen.getByText('common.members.editor'))

    expect(await screen.findByText('common.members.datasetOperator')).toBeInTheDocument()
    expect(screen.queryByText('common.members.admin')).not.toBeInTheDocument()
  })

  it('should fall back to normal role label when member role is unknown', () => {
    renderOperation({ role: 'unknown_role' as Member['role'] })

    expect(screen.getByText('common.members.normal')).toBeInTheDocument()
  })

  it('should call deleteMemberOrCancelInvitation when removing the member', async () => {
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
