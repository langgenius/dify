import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MemberRow from '../member-row'

const member: AccountWithRoleResponse = {
  id: 'member-1',
  name: 'Member User',
  email: 'member@example.com',
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [],
  last_active_at: 1731000000,
  last_login_at: 1731000000,
  created_at: 1731000000,
  status: 'active',
}

const renderMemberRow = () => {
  renderWithConsoleQuery(
    <Dialog<AccountWithRoleResponse>>
      {({ payload }) => (
        <>
          <table>
            <tbody>
              <MemberRow
                member={member}
                roles={[{ id: 'role-1', name: 'Editor' }]}
                isCurrentUser={false}
                canManage
                canTransferOwnership={false}
                allowMultipleRoles={false}
              />
            </tbody>
          </table>
          <DialogContent>
            <DialogTitle>{payload?.name}</DialogTitle>
            <DialogClose>Close details</DialogClose>
          </DialogContent>
        </>
      )}
    </Dialog>,
  )
}

describe('MemberRow details entry points', () => {
  it.each(['name button', 'email'])('opens the member details from the %s', async (target) => {
    const user = userEvent.setup()
    renderMemberRow()
    const trigger = screen.getByRole('button', { name: 'Member User' })
    await user.click(
      target === 'name button'
        ? trigger
        : within(screen.getByRole('row')).getByText('member@example.com'),
    )
    expect(screen.getByRole('dialog', { name: member.name })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps details and member actions as separate keyboard stops', async () => {
    const user = userEvent.setup()
    renderMemberRow()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Member User' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: member.name })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Member User' })).toHaveFocus())
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'workspaceMembers.members.memberActions: Member User' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps member menu and its portaled confirmation separate from details', async () => {
    const user = userEvent.setup()
    renderMemberRow()
    await user.click(
      screen.getByRole('button', { name: /workspaceMembers\.members\.memberActions/ }),
    )
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('menuitem', { name: 'workspaceMembers.members.removeFromTeam' }),
    )
    const confirmation = screen.getByRole('alertdialog')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(
      within(confirmation).getByText('workspaceMembers.members.removeFromTeamConfirmDescription'),
    )
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
