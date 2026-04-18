import type { Recipient as RecipientItem } from '../../../../types'
import type { Member } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import EmailInput from '../email-input'

const mockEmailItem = vi.hoisted(() => vi.fn())
const mockMemberList = vi.hoisted(() => vi.fn())

vi.mock('../email-item', () => ({
  __esModule: true,
  default: (props: {
    email: string
    data: { email?: string, name?: string }
    isError: boolean
  }) => {
    mockEmailItem(props)
    return (
      <div data-testid="selected-email-item">
        {props.data.email}
        |
        {props.data.name}
        |
        {props.isError ? 'error' : 'ok'}
      </div>
    )
  },
}))

vi.mock('../member-list', () => ({
  __esModule: true,
  default: (props: {
    searchValue: string
    onSelect: (value: string) => void
  }) => {
    mockMemberList(props)
    return (
      <div data-testid="member-list">
        <div>{props.searchValue}</div>
        <button type="button" onClick={() => props.onSelect('member-2')}>
          select-member
        </button>
      </div>
    )
  },
}))

const createMember = (overrides: Partial<Member>): Member => ({
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
  ...overrides,
})

const members: Member[] = [
  createMember({}),
  createMember({
    id: 'member-2',
    email: 'member-2@example.com',
    name: 'Member Two',
  }),
]

describe('human-input/delivery-method/recipient/email-input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should map selected members, show the placeholder on focus, and select a member from the list', () => {
    const handleSelect = vi.fn()
    const handleDelete = vi.fn()
    const { container } = render(
      <EmailInput
        email="owner@example.com"
        value={[{ type: 'member', user_id: 'member-1' } as RecipientItem]}
        list={members}
        onDelete={handleDelete}
        onSelect={handleSelect}
        onAdd={vi.fn()}
      />,
    )

    expect(screen.getByTestId('selected-email-item')).toHaveTextContent('member-1@example.com|Member One|ok')

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', '')

    fireEvent.click(container.querySelector('.max-h-24') as HTMLDivElement)
    expect(input).toHaveAttribute('placeholder', 'workflow.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.placeholder')

    fireEvent.change(input, { target: { value: 'member' } })
    expect(screen.getByTestId('member-list')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'select-member' }))

    expect(handleSelect).toHaveBeenCalledWith('member-2')
  })

  it('should add external emails, select existing members, and ignore invalid or duplicate values', () => {
    const handleSelect = vi.fn()
    const handleAdd = vi.fn()

    render(
      <EmailInput
        email="owner@example.com"
        value={[{ type: 'external', email: 'existing@example.com' } as RecipientItem]}
        list={members}
        onDelete={vi.fn()}
        onSelect={handleSelect}
        onAdd={handleAdd}
      />,
    )

    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'member-2@example.com' } })
    fireEvent.keyDown(input, { key: ',', code: 'Comma' })
    expect(handleSelect).toHaveBeenCalledWith('member-2')

    fireEvent.change(input, { target: { value: 'new@example.com' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(handleAdd).toHaveBeenCalledWith('new@example.com')

    fireEvent.change(input, { target: { value: 'existing@example.com' } })
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' })

    fireEvent.change(input, { target: { value: 'bad-email' } })
    fireEvent.blur(input)

    expect(handleAdd).toHaveBeenCalledTimes(1)
    expect(handleSelect).toHaveBeenCalledTimes(1)
  })

  it('should delete the last recipient with backspace, flag missing members as errors, and stop focusing when disabled', () => {
    const handleDelete = vi.fn()
    const { container, rerender } = render(
      <EmailInput
        email="owner@example.com"
        value={[{ type: 'member', user_id: 'missing-member' } as RecipientItem]}
        list={members}
        onDelete={handleDelete}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    expect(screen.getByTestId('selected-email-item')).toHaveTextContent('||error')

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace' })
    expect(handleDelete).toHaveBeenCalledWith({ type: 'member', user_id: 'missing-member' })

    rerender(
      <EmailInput
        email="owner@example.com"
        value={[]}
        list={members}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        disabled
      />,
    )

    fireEvent.click(container.querySelector('.max-h-24') as HTMLDivElement)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
