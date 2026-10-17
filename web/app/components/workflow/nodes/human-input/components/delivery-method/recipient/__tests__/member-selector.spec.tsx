import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemberSelector from '../member-selector'

const members: AccountWithRoleResponse[] = [
  {
    id: 'member-1',
    email: 'member-1@example.com',
    name: 'Member One',
    avatar: 'avatar-data',
    avatar_url: 'avatar.png',
    status: 'active',
    role: 'normal',
    roles: [],
    created_at: 1767225600,
    last_active_at: 1767312000,
    last_login_at: 1767398400,
  },
]

it('filters real members and closes the selector after adding the chosen recipient', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<MemberSelector value={[]} email="owner@example.com" onSelect={onSelect} list={members} />)
  const trigger = screen.getByRole('button', {
    name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.trigger',
  })
  await user.click(trigger)
  const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
  await user.type(search, 'missing')
  expect(screen.queryByRole('button', { name: /Member One/ })).not.toBeInTheDocument()
  await user.clear(search)
  await user.type(search, 'MEMBER-1@')
  await user.click(screen.getByRole('button', { name: /Member One/ }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('member-1')
  await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument())
})
