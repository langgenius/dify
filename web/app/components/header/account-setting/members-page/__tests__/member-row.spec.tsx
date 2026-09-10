import type { Member } from '@/models/common'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MemberRow from '../member-row'

vi.mock('@/hooks/use-format-time-from-now')
vi.mock('@/service/access-control/use-member-roles')

const member: Member = {
  id: 'member-1',
  name: 'Member User',
  email: 'member@example.com',
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [],
  last_active_at: '1731000000',
  last_login_at: '1731000000',
  created_at: '1731000000',
  status: 'active',
}

const renderMemberRow = (onOpenDetails = vi.fn()) => {
  renderWithConsoleQuery(
    <table>
      <tbody>
        <MemberRow
          member={member}
          roles={[{ id: 'role-1', name: 'Editor' }]}
          isCurrentUser={false}
          canManage
          canTransferOwnership={false}
          allowMultipleRoles={false}
          onOpenDetails={onOpenDetails}
          onTransferOwnership={vi.fn()}
        />
      </tbody>
    </table>,
  )
  return onOpenDetails
}

describe('MemberRow details entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useFormatTimeFromNow).mockReturnValue({
      formatTimeFromNow: () => 'just now',
    })
    vi.mocked(useUpdateRolesOfMember).mockReturnValue({
      mutateAsync: vi.fn(),
    } as unknown as ReturnType<typeof useUpdateRolesOfMember>)
  })

  it.each([
    ['email', 'member@example.com'],
    ['last activity', 'just now'],
    ['role', 'Editor'],
    ['avatar', 'M'],
  ])('should open details once when clicking the %s', async (_region, text) => {
    const user = userEvent.setup()
    const onOpenDetails = renderMemberRow()

    await user.click(within(screen.getByRole('row')).getByText(text))

    expect(onOpenDetails).toHaveBeenCalledExactlyOnceWith(member)
  })

  it.each(['pointer', 'Enter', 'Space'])(
    'should open details once from the name button with %s',
    async (interaction) => {
      const user = userEvent.setup()
      const onOpenDetails = renderMemberRow()
      const nameButton = screen.getByRole('button', { name: 'Member User' })

      if (interaction === 'pointer') {
        await user.click(nameButton)
      } else {
        nameButton.focus()
        await user.keyboard(interaction === 'Enter' ? '{Enter}' : ' ')
      }

      expect(onOpenDetails).toHaveBeenCalledExactlyOnceWith(member)
    },
  )

  it('should keep member menu and its portaled confirmation separate from details', async () => {
    const user = userEvent.setup()
    const onOpenDetails = renderMemberRow()

    await user.click(screen.getByRole('button', { name: /common\.members\.memberActions/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(onOpenDetails).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitem', { name: 'common.members.removeFromTeam' }))
    const confirmation = screen.getByRole('alertdialog')
    expect(onOpenDetails).not.toHaveBeenCalled()

    await user.click(
      within(confirmation).getByText('common.members.removeFromTeamConfirmDescription'),
    )
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onOpenDetails).not.toHaveBeenCalled()
  })
})
