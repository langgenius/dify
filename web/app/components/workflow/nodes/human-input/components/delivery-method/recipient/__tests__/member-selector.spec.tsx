import type { Member } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import MemberSelector from '../member-selector'

const mockMemberList = vi.hoisted(() => vi.fn())

vi.mock('../member-list', () => ({
  __esModule: true,
  default: (props: {
    searchValue: string
    list: Member[]
    email: string
  }) => {
    mockMemberList(props)
    return <div data-testid="member-list" />
  },
}))

const members: Member[] = [{
  id: 'member-1',
  email: 'member-1@example.com',
  name: 'Member One',
  avatar: 'avatar-data',
  avatar_url: 'avatar.png',
  status: 'active',
  role: 'normal',
  created_at: '2026-01-01T00:00:00Z',
  last_active_at: '2026-01-02T00:00:00Z',
  last_login_at: '2026-01-03T00:00:00Z',
}]

describe('human-input/delivery-method/recipient/member-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should toggle the member list and forward selection props', () => {
    render(
      <MemberSelector
        value={[{ type: 'member', user_id: 'member-1' }]}
        email="owner@example.com"
        onSelect={vi.fn()}
        list={members}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'workflow.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.trigger',
    })

    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByTestId('member-list')).toBeInTheDocument()
    expect(trigger).toHaveClass('bg-state-accent-hover')
    expect(mockMemberList).toHaveBeenCalledWith(expect.objectContaining({
      searchValue: '',
      list: members,
      email: 'owner@example.com',
    }))

    fireEvent.click(trigger)
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument()
  })
})
