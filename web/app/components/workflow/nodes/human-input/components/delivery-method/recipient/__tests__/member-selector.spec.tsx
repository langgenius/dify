import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemberSelector from '../member-selector'

const mockMemberList = vi.hoisted(() => vi.fn())

vi.mock('../member-list', () => ({
  __esModule: true,
  default: (props: {
    searchValue: string
    list: AccountWithRoleResponse[]
    email: string
    onSearchChange: (value: string) => void
    onSelect: (memberId: string) => void
  }) => {
    mockMemberList(props)
    return (
      <div data-testid="member-list">
        <input
          aria-label="member search"
          value={props.searchValue}
          onChange={(e) => props.onSearchChange(e.target.value)}
        />
        <button type="button" onClick={() => props.onSelect('member-1')}>
          select member
        </button>
      </div>
    )
  },
}))

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

describe('human-input/delivery-method/recipient/member-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should toggle the member list and forward selection props', async () => {
    const user = userEvent.setup()

    render(
      <MemberSelector
        value={[{ type: 'member', user_id: 'member-1' }]}
        email="owner@example.com"
        onSelect={vi.fn()}
        list={members}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.trigger',
    })

    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByTestId('member-list')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('data-popup-open')
    expect(trigger).toHaveClass('data-popup-open:bg-state-accent-hover')
    expect(mockMemberList).toHaveBeenCalledWith(
      expect.objectContaining({
        searchValue: '',
        list: members,
        email: 'owner@example.com',
      }),
    )

    await user.click(trigger)
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument()
  })

  it('should update search value and close the list after selecting a member', async () => {
    const user = userEvent.setup()
    const handleSelect = vi.fn()

    render(
      <MemberSelector
        value={[]}
        email="owner@example.com"
        onSelect={handleSelect}
        list={members}
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.trigger',
      }),
    )
    await user.type(screen.getByRole('textbox', { name: 'member search' }), 'member one')

    expect(mockMemberList).toHaveBeenLastCalledWith(
      expect.objectContaining({
        searchValue: 'member one',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'select member' }))

    expect(handleSelect).toHaveBeenCalledWith('member-1')
    expect(screen.queryByTestId('member-list')).not.toBeInTheDocument()
  })
})
