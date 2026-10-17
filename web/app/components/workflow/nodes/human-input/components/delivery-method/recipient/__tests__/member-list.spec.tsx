import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import MemberList from '../member-list'

const createMember = (overrides: Partial<AccountWithRoleResponse>): AccountWithRoleResponse => ({
  id: 'member-1',
  email: 'owner@example.com',
  name: 'Owner',
  avatar: 'avatar-data',
  avatar_url: 'owner.png',
  status: 'active',
  role: 'normal',
  roles: [],
  created_at: 1767225600,
  last_active_at: 1767312000,
  last_login_at: 1767398400,
  ...overrides,
})

const members: AccountWithRoleResponse[] = [
  createMember({}),
  createMember({
    id: 'member-2',
    email: 'pending@example.com',
    name: 'Pending User',
    status: 'pending',
    avatar_url: 'pending.png',
  }),
]

describe('human-input/delivery-method/recipient/member-list', () => {
  it('should filter members, show selected state, and only add unselected members', async () => {
    const user = userEvent.setup()
    const handleSelect = vi.fn()
    const TestMemberList = () => {
      const [searchValue, setSearchValue] = useState('pending')

      return (
        <MemberList
          value={[{ type: 'member', user_id: 'member-1' }]}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          list={members}
          onSelect={handleSelect}
          email="owner@example.com"
        />
      )
    }

    render(<TestMemberList />)

    const searchBox = screen.getByRole('searchbox', { name: 'common.operation.search' })
    await user.clear(searchBox)
    await user.type(searchBox, 'owner')
    expect(screen.queryByText('Pending User')).not.toBeInTheDocument()
    const owner = screen.getByRole('button', { name: /Owner/ })
    expect(owner).toBeDisabled()
    expect(screen.getByText('workspaceMembers.members.you')).toBeInTheDocument()
    await user.click(owner)
    expect(handleSelect).not.toHaveBeenCalled()

    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.add',
      ),
    ).not.toBeInTheDocument()

    await user.clear(searchBox)
    await user.type(searchBox, 'pending')

    expect(screen.getByText('Pending User')).toBeInTheDocument()
    expect(screen.getByText('workspaceMembers.members.pending')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Pending User/ }))
    expect(handleSelect).toHaveBeenCalledWith('member-2')
  })

  it('hides the compact list when the search has no matching members', () => {
    render(
      <MemberList
        value={[]}
        searchValue="missing"
        onSearchChange={vi.fn()}
        list={members}
        onSelect={vi.fn()}
        email="owner@example.com"
        hideSearch
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})
