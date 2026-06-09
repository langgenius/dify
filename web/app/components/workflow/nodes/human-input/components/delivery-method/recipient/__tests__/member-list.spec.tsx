import type { Member } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import MemberList from '../member-list'

const createMember = (overrides: Partial<Member>): Member => ({
  id: 'member-1',
  email: 'owner@example.com',
  name: 'Owner',
  avatar: 'avatar-data',
  avatar_url: 'owner.png',
  status: 'active',
  role: 'normal',
  created_at: '2026-01-01T00:00:00Z',
  last_active_at: '2026-01-02T00:00:00Z',
  last_login_at: '2026-01-03T00:00:00Z',
  ...overrides,
})

const members: Member[] = [
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
  it('should filter members, show selected state, and only add unselected members', () => {
    const handleSearchChange = vi.fn()
    const handleSelect = vi.fn()

    render(
      <MemberList
        value={[{ type: 'member', user_id: 'member-1' }]}
        searchValue="pending"
        onSearchChange={handleSearchChange}
        list={members}
        onSelect={handleSelect}
        email="owner@example.com"
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'owner' } })
    expect(handleSearchChange).toHaveBeenCalledWith('owner')

    expect(screen.getByText('Pending User')).toBeInTheDocument()
    expect(screen.getByText('common.members.pending')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.add')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Pending User'))
    expect(handleSelect).toHaveBeenCalledWith('member-2')
  })

  it('should show selected members as added, mark the current user, and return null when hideSearch has no matches', () => {
    const handleSelect = vi.fn()
    const { container, rerender } = render(
      <MemberList
        value={[{ type: 'member', user_id: 'member-1' }]}
        searchValue=""
        onSearchChange={vi.fn()}
        list={members}
        onSelect={handleSelect}
        email="owner@example.com"
        hideSearch
      />,
    )

    expect(screen.getByText('common.members.you')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.added')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Owner'))
    expect(handleSelect).not.toHaveBeenCalled()

    rerender(
      <MemberList
        value={[]}
        searchValue="missing"
        onSearchChange={vi.fn()}
        list={members}
        onSelect={handleSelect}
        email="owner@example.com"
        hideSearch
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
